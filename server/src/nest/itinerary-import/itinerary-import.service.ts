import { HttpException, Injectable } from '@nestjs/common';
import {
  normalizePlaceWebsite,
  type ItineraryImportCategory,
  type ItineraryImportConfirmResponse,
  type ItineraryImportPlace,
  type ItineraryImportPlanDay,
  type ItineraryImportPreviewResponse,
} from '@trek/shared';
import type { User } from '../../types';
import { DatabaseService } from '../database/database.service';
import { LlmConfigResolver } from '../llm-parse/llm-config.resolver';
import { MapsService } from '../maps/maps.service';
import { trekPlacesSearch } from '../maps/trek-places.client';
import { PlacesService } from '../places/places.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { PermissionsService } from '../permissions/permissions.service';
import { extractItineraryText } from './itinerary-text';
import { completeJson } from './itinerary-llm';
import {
  buildItinerarySystemPrompt,
  normalizeExtraction,
  ITINERARY_USER_PREFIX,
  type ExtractedPlace,
  type PromptDay,
} from './itinerary-prompt';

/** Enough for a two-week plan with an appendix; a longer text is cut and flagged. */
const MAX_TEXT_CHARS = 60_000;
/** Geocoding runs a few at a time: the TREK index is quick, Nominatim is throttled process-wide anyway. */
const GEOCODE_CONCURRENCY = 4;

/** Our categories → the names TREK seeds. Matched case-insensitively; a renamed category just stays unset. */
const CATEGORY_NAMES: Record<ItineraryImportCategory, string[]> = {
  restaurant: ['restaurant'],
  cafe: ['bar/cafe', 'cafe', 'restaurant'],
  attraction: ['attraction', 'sight', 'sightseeing'],
  shopping: ['shopping'],
  hotel: ['hotel', 'accommodation'],
  nature: ['nature', 'park'],
  activity: ['activity'],
  transport: ['transport'],
  other: ['other'],
};

interface DayRow {
  id: number;
  day_number: number;
  date: string | null;
  title: string | null;
}

export interface ItinerarySource {
  buffer?: Buffer;
  fileName?: string;
  text?: string;
}

@Injectable()
export class ItineraryImportService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly llmConfig: LlmConfigResolver,
    private readonly maps: MapsService,
    private readonly places: PlacesService,
    private readonly assignments: AssignmentsService,
    private readonly permissions: PermissionsService,
  ) {}

  aiAvailable(userId: number): boolean {
    return this.llmConfig.resolve(userId) !== null;
  }

  /** Read the document, ask the model, place everything on the map. Writes nothing. */
  async preview(tripId: string, userId: number, source: ItinerarySource): Promise<ItineraryImportPreviewResponse> {
    const config = this.llmConfig.resolve(userId);
    if (!config) throw new HttpException({ error: 'AI parsing is not configured' }, 409);

    let text = source.text ?? '';
    if (source.buffer && source.fileName) {
      try {
        text = await extractItineraryText(source.buffer, source.fileName);
      } catch (err) {
        throw new HttpException({ error: `Could not read ${source.fileName}: ${err instanceof Error ? err.message : String(err)}` }, 400);
      }
    }
    text = text.trim();
    if (!text) throw new HttpException({ error: 'No readable text found in the document' }, 400);
    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS);

    const trip = this.dbs.get<{ title: string }>('SELECT title FROM trips WHERE id = ?', tripId);
    const days = this.tripDays(tripId);
    const promptDays: PromptDay[] = days.map((d) => ({ day_number: d.day_number, date: d.date, title: d.title }));

    let raw: unknown;
    const aiStart = Date.now();
    try {
      raw = await completeJson(config, buildItinerarySystemPrompt(trip?.title ?? '', promptDays), ITINERARY_USER_PREFIX + text);
      console.warn(`[itinerary-import] AI answered in ${Math.round((Date.now() - aiStart) / 1000)}s (${text.length} chars in)`);
    } catch (err) {
      console.error('[itinerary-import] AI call failed:', err instanceof Error ? err.message : err);
      throw new HttpException({ error: `AI parsing failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
    const extracted = normalizeExtraction(raw);
    if (extracted.places.length === 0) {
      throw new HttpException({ error: 'The AI found no places in this document' }, 422);
    }

    const geoStart = Date.now();
    await this.geocodeAll(extracted.places);
    console.warn(`[itinerary-import] geocoded ${extracted.places.length} place(s) in ${Math.round((Date.now() - geoStart) / 1000)}s`);

    const byNumber = new Map(days.map((d) => [d.day_number, d]));
    const plan = extracted.plan
      .map((p) => {
        const day = byNumber.get(p.day_number);
        return day ? { day_id: day.id, day_number: day.day_number, date: day.date, title: day.title, place_keys: p.place_keys } : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .sort((a, b) => a.day_number - b.day_number);

    const warnings: string[] = [];
    const unlocated = extracted.places.filter((p) => p.lat == null).length;
    if (unlocated) warnings.push(`${unlocated} place(s) could not be found on the map and will be added without a location.`);
    if (truncated) warnings.push(`The document was longer than ${MAX_TEXT_CHARS} characters; only the first part was read.`);

    return {
      places: extracted.places.map(({ geocode_query: _q, ...place }) => place),
      plan,
      todos: extracted.todos,
      warnings,
      truncated,
    };
  }

  /** Persist the confirmed places and, when given, Plan A's day assignments. */
  confirm(
    tripId: string,
    user: User,
    body: { places: ItineraryImportPlace[]; plan: ItineraryImportPlanDay[]; tentative_tag_name: string },
    socketId?: string,
  ): ItineraryImportConfirmResponse {
    const trip = this.dbs.canAccessTrip(tripId, user.id);
    if (!trip) throw new HttpException({ error: 'Trip not found' }, 404);
    if (body.plan.length && !this.permissions.checkPermission('day_edit', user.role, trip.user_id, user.id, trip.user_id !== user.id)) {
      throw new HttpException({ error: 'No permission' }, 403);
    }

    const categoryIds = this.categoryIds();
    const dayIds = new Set(this.tripDays(tripId).map((d) => d.id));

    // All or nothing: a failure halfway must not leave half a document on the
    // trip. Broadcasts wait until the rows are committed.
    const { createdPlaces, createdAssignments, skipped } = this.dbs.transaction(() => {
      const tentativeTagId = body.places.some((p) => p.tentative) ? this.tentativeTag(user.id, body.tentative_tag_name) : null;
      const keyToPlaceId = new Map<string, number>();
      const createdPlaces: ReturnType<PlacesService['create']>[] = [];
      let skipped = 0;
      for (const p of body.places) {
        const existing = this.places.findMatchingPlaceId(tripId, { name: p.name, lat: p.lat ?? null, lng: p.lng ?? null });
        if (existing) {
          keyToPlaceId.set(p.key, existing);
          skipped++;
          continue;
        }
        const place = this.places.create(tripId, {
          name: p.name,
          lat: p.lat ?? undefined,
          lng: p.lng ?? undefined,
          category_id: categoryIds[p.category] ?? undefined,
          notes: composeNotes(p) ?? undefined,
          website: normalizePlaceWebsite(p.url) ?? undefined,
          place_time: p.time ?? undefined,
          tags: tentativeTagId && p.tentative ? [tentativeTagId] : [],
        } as never);
        keyToPlaceId.set(p.key, place.id);
        createdPlaces.push(place);
      }

      const createdAssignments: NonNullable<ReturnType<AssignmentsService['createAssignment']>>[] = [];
      for (const day of body.plan) {
        if (!dayIds.has(day.day_id)) continue;
        const already = new Set(
          this.dbs.all<{ place_id: number }>('SELECT place_id FROM day_assignments WHERE day_id = ?', day.day_id).map((r) => r.place_id),
        );
        for (const key of day.place_keys) {
          const placeId = keyToPlaceId.get(key);
          if (!placeId || already.has(placeId)) continue;
          const assignment = this.assignments.createAssignment(day.day_id, placeId);
          already.add(placeId);
          if (assignment) createdAssignments.push(assignment);
        }
      }
      return { createdPlaces, createdAssignments, skipped };
    });

    for (const place of createdPlaces) {
      this.places.broadcast(tripId, 'place:created', { place }, socketId);
      this.places.onCreated(tripId, place.id);
    }
    for (const assignment of createdAssignments) {
      this.assignments.broadcast(tripId, 'assignment:created', { assignment }, socketId);
    }
    if (createdAssignments.length) this.assignments.reconcile(tripId, socketId);

    const created = createdPlaces.length;
    const assigned = createdAssignments.length;
    return { created, skipped, assigned };
  }

  private tripDays(tripId: string): DayRow[] {
    return this.dbs.all<DayRow>('SELECT id, day_number, date, title FROM days WHERE trip_id = ? ORDER BY day_number', tripId);
  }

  private categoryIds(): Partial<Record<ItineraryImportCategory, number>> {
    const rows = this.dbs.all<{ id: number; name: string }>('SELECT id, name FROM categories');
    const byName = new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
    const out: Partial<Record<ItineraryImportCategory, number>> = {};
    for (const [cat, names] of Object.entries(CATEGORY_NAMES) as [ItineraryImportCategory, string[]][]) {
      const id = names.map((n) => byName.get(n)).find((v) => v !== undefined);
      if (id !== undefined) out[cat] = id;
    }
    return out;
  }

  /** The caller's own tag with this name, created on first use. */
  private tentativeTag(userId: number, name: string): number {
    const found = this.dbs.get<{ id: number }>('SELECT id FROM tags WHERE user_id = ? AND name = ?', userId, name);
    if (found) return found.id;
    return Number(this.dbs.run('INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)', userId, name, '#f59e0b').lastInsertRowid);
  }

  /**
   * Put every place on the map, anchored to its city.
   *
   * Appending "上野 東京" to a restaurant name made the TREK index miss places it
   * finds by name alone, and a bare name lands on a namesake in another town.
   * So: find each city's centre once, search the plain names biased towards it,
   * and accept only a hit within reach of that centre. What the index cannot
   * place gets one Nominatim try as "name city" — one, because every Nominatim
   * call waits for a process-wide 1.1 s slot.
   */
  private async geocodeAll(places: ExtractedPlace[]): Promise<void> {
    // City centres come from Nominatim, not the TREK index: the index is a
    // business directory, and its top hit for "札幌" is a shop called 札幌 in
    // Nagano — which then disqualified every real place in Sapporo as too far.
    const cityCentres = new Map<string, Promise<LatLng | null>>();
    const centreOf = (city: string | null | undefined) => {
      if (!city) return Promise.resolve(null);
      let c = cityCentres.get(city);
      if (!c) {
        c = this.maps
          .searchNominatim(city, undefined, 'background')
          .then((hits) => {
            const h = hits.find((x) => x.lat != null && x.lng != null);
            return h ? { lat: h.lat!, lng: h.lng! } : null;
          })
          .catch(() => null);
        cityCentres.set(city, c);
      }
      return c;
    };
    let next = 0;
    const worker = async () => {
      while (next < places.length) {
        const p = places[next++];
        const hit = await this.locate(p, await centreOf(p.city));
        if (hit) {
          p.lat = hit.lat;
          p.lng = hit.lng;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(GEOCODE_CONCURRENCY, places.length) }, worker));
  }

  private async locate(p: ExtractedPlace, centre: LatLng | null): Promise<LatLng | null> {
    const near = (h: LatLng) => !centre || distanceKm(centre, h) <= CITY_RADIUS_KM;
    if (this.maps.trekPlacesEnabled()) {
      for (const q of nameQueries(p)) {
        try {
          const hits = await trekPlacesSearch(q, { limit: 5, ...(centre ?? {}) });
          const hit = hits.find((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng) && near(h));
          if (hit) return { lat: hit.lat, lng: hit.lng };
        } catch {
          break; // the index is down; Nominatim below still gets its one try
        }
      }
    }
    const name = p.local_name || p.name;
    try {
      const hits = await this.maps.searchNominatim(p.city ? `${name} ${p.city}` : name, undefined, 'background', centre ?? undefined);
      const hit = hits.find((h) => h.lat != null && h.lng != null && near({ lat: h.lat, lng: h.lng }));
      return hit ? { lat: hit.lat!, lng: hit.lng! } : null;
    } catch {
      return null;
    }
  }
}

type LatLng = { lat: number; lng: number };

/** A place further than this from its city's centre is a namesake, not the place. */
const CITY_RADIUS_KM = 60;

/**
 * The index searches for one place: the local-script name first (the index
 * speaks the destination's language), then the model's short query, then the
 * name as written with anything in brackets dropped.
 */
export function nameQueries(p: Pick<ExtractedPlace, 'geocode_query' | 'local_name' | 'name'>): string[] {
  const plain = p.name.replace(/[(（][^)）]*[)）]/g, '').trim();
  return [p.local_name, p.geocode_query, plain, p.name]
    .filter((q, i, all): q is string => !!q && all.indexOf(q) === i)
    .slice(0, 3);
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Rating, hours and the model's notes, one per line — the place's own notes field. */
export function composeNotes(p: Pick<ItineraryImportPlace, 'rating' | 'opening_hours' | 'notes' | 'local_name' | 'name'>): string | null {
  const lines = [
    p.local_name && p.local_name !== p.name ? p.local_name : null,
    p.rating ? `⭐ ${p.rating}` : null,
    p.opening_hours ? `🕒 ${p.opening_hours}` : null,
    p.notes,
  ].filter((l): l is string => !!l && !!l.trim());
  return lines.length ? lines.join('\n').slice(0, 2000) : null;
}
