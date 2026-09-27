/**
 * @file        itinerary-import.service.ts
 * @description Itinerary import: planning document -> AI -> geocoded places + Plan A preview,
 *              and the transactional confirm that writes places, day assignments and to-dos.
 * @module      server/nest/itinerary-import
 * @layer       backend
 * @dependencies DatabaseService, LlmConfigResolver, MapsService, PlacesService, AssignmentsService,
 *              PermissionsService, TodoService, trek-places client
 * @author      Claude (AI) for project owner
 * @created     2026-09-26
 * @lastModified 2026-09-27 — Confirm returns created ids; new undo() removes exactly one import. (see CHANGELOG.md)
 */
import { HttpException, Injectable } from '@nestjs/common';
import {
  normalizePlaceWebsite,
  type ItineraryImportCategory,
  type ItineraryImportConfirmResponse,
  type ItineraryImportPlace,
  type ItineraryImportPlanDay,
  type ItineraryImportPreviewResponse,
  type ItineraryImportUndoResponse,
} from '@trek/shared';
import type { User } from '../../types';
import { DatabaseService } from '../database/database.service';
import { LlmConfigResolver } from '../llm-parse/llm-config.resolver';
import { MapsService } from '../maps/maps.service';
import { trekPlacesSearch } from '../maps/trek-places.client';
import { PlacesService } from '../places/places.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { PermissionsService } from '../permissions/permissions.service';
import { TodoService } from '../todo/todo.service';
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
/**
 * Stop looking up new places after this long. A phone that locks its screen
 * drops a request that has been waiting for minutes; places not reached in time
 * are still imported, just without a location.
 */
const GEOCODE_BUDGET_MS = 90_000;

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
    private readonly todo: TodoService,
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
    await this.geocodeAll(extracted.places, extracted.cities);
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
    body: {
      places: ItineraryImportPlace[];
      plan: ItineraryImportPlanDay[];
      tentative_tag_name: string;
      todos: string[];
      todo_category?: string | null;
    },
    socketId?: string,
  ): ItineraryImportConfirmResponse {
    const trip = this.dbs.canAccessTrip(tripId, user.id);
    if (!trip) throw new HttpException({ error: 'Trip not found' }, 404);
    const can = (action: string) => this.permissions.checkPermission(action, user.role, trip.user_id, user.id, trip.user_id !== user.id);
    // Each part needs the right its own route would: day plan → day_edit,
    // to-do list → packing_edit (the to-do controller's action).
    if (body.plan.length && !can('day_edit')) throw new HttpException({ error: 'No permission' }, 403);
    if (body.todos.length && !can('packing_edit')) throw new HttpException({ error: 'No permission' }, 403);

    const categoryIds = this.categoryIds();
    const dayIds = new Set(this.tripDays(tripId).map((d) => d.id));

    // All or nothing: a failure halfway must not leave half a document on the
    // trip. Broadcasts wait until the rows are committed.
    const { createdPlaces, createdAssignments, createdTodos, skipped } = this.dbs.transaction(() => {
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
      const createdTodos = body.todos.map((name) => this.todo.createItem(tripId, { name, category: body.todo_category ?? undefined }));
      return { createdPlaces, createdAssignments, createdTodos, skipped };
    });

    for (const place of createdPlaces) {
      this.places.broadcast(tripId, 'place:created', { place }, socketId);
      this.places.onCreated(tripId, place.id);
    }
    for (const assignment of createdAssignments) {
      this.assignments.broadcast(tripId, 'assignment:created', { assignment }, socketId);
    }
    if (createdAssignments.length) this.assignments.reconcile(tripId, socketId);
    for (const item of createdTodos) {
      if (item) this.todo.broadcast(tripId, 'todo:created', { item } as never, socketId);
    }

    const created = createdPlaces.length;
    const assigned = createdAssignments.length;
    const idOf = (row: unknown) => Number((row as { id: number }).id);
    return {
      created,
      skipped,
      assigned,
      todos_added: createdTodos.length,
      place_ids: createdPlaces.map(idOf),
      assignment_ids: createdAssignments.map(idOf),
      todo_ids: createdTodos.filter(Boolean).map(idOf),
    };
  }

  /**
   * Undo one import: remove exactly the rows it created.
   *
   * Places go through the same path as the places bulk delete (journey hooks,
   * linked expenses, cancelled stays, broadcasts), so an undo leaves the trip as
   * a manual delete would. Their day stops go with them by FK cascade; stops the
   * import put on places that already existed are removed one by one. Ids from
   * another trip are ignored.
   * @param {string} tripId - Trip the import was made into.
   * @param {User} user - Caller; needs day_edit / packing_edit for stops / to-dos.
   * @param {{place_ids:number[], assignment_ids:number[], todo_ids:number[]}} body - Ids from the confirm response.
   * @param {string} [socketId] - Originating socket, not echoed.
   * @returns {Promise<ItineraryImportUndoResponse>} How many rows of each kind were removed.
   */
  async undo(
    tripId: string,
    user: User,
    body: { place_ids: number[]; assignment_ids: number[]; todo_ids: number[] },
    socketId?: string,
  ): Promise<ItineraryImportUndoResponse> {
    const trip = this.dbs.canAccessTrip(tripId, user.id);
    if (!trip) throw new HttpException({ error: 'Trip not found' }, 404);
    const can = (action: string) => this.permissions.checkPermission(action, user.role, trip.user_id, user.id, trip.user_id !== user.id);
    if (body.assignment_ids.length && !can('day_edit')) throw new HttpException({ error: 'No permission' }, 403);
    if (body.todo_ids.length && !can('packing_edit')) throw new HttpException({ error: 'No permission' }, 403);

    // Read the stops (with their day) before anything is deleted: the cascade
    // would take the ones on imported places with it, and clients still need
    // their assignment:deleted to drop them from the day.
    const stops = body.assignment_ids.length
      ? this.dbs.all<{ id: number; day_id: number }>(
          `SELECT da.id, da.day_id FROM day_assignments da JOIN days d ON d.id = da.day_id
           WHERE d.trip_id = ? AND da.id IN (${body.assignment_ids.map(() => '?').join(',')})`,
          tripId,
          ...body.assignment_ids,
        )
      : [];

    const scoped = this.places.scopedIds(tripId, body.place_ids);
    for (const id of scoped) this.places.onDeleted(id);
    const expenseIds = this.places.linkedExpenseIds(tripId, scoped);
    const { deleted, cancelled } = await this.places.removeMany(tripId, scoped);

    let todosRemoved = 0;
    this.dbs.transaction(() => {
      for (const stop of stops) this.assignments.deleteAssignment(stop.id);
      for (const id of body.todo_ids) if (this.todo.deleteItem(tripId, id)) todosRemoved++;
    });

    for (const stop of stops) {
      this.assignments.broadcast(tripId, 'assignment:deleted', { assignmentId: stop.id, dayId: stop.day_id }, socketId);
    }
    for (const id of deleted) this.places.broadcast(tripId, 'place:deleted', { placeId: id }, socketId);
    for (const reservationId of cancelled.reservationIds) {
      this.places.broadcast(tripId, 'reservation:deleted', { reservationId }, undefined);
    }
    for (const itemId of [...expenseIds, ...cancelled.budgetItemIds]) {
      this.places.broadcast(tripId, 'budget:deleted', { itemId }, undefined);
    }
    for (const id of body.todo_ids) this.todo.broadcast(tripId, 'todo:deleted', { itemId: id }, socketId);
    if (stops.length) this.assignments.reconcile(tripId, socketId);

    return { places_removed: deleted.length, assignments_removed: stops.length, todos_removed: todosRemoved };
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
  private async geocodeAll(places: ExtractedPlace[], knownCentres: Map<string, LatLng> = new Map()): Promise<void> {
    // City centres come first from the model, which knows which 旭川 the notes
    // mean; a bare-name lookup put it at a namesake in Akita, 480 km away, and
    // disqualified every real place in Asahikawa. Nominatim is the fallback, and
    // never the TREK index: that is a business directory, whose top hit for
    // "札幌" is a shop called 札幌 in Nagano.
    const cityCentres = new Map<string, Promise<LatLng | null>>();
    const centreOf = (city: string | null | undefined) => {
      if (!city) return Promise.resolve(null);
      const known = knownCentres.get(city);
      if (known) return Promise.resolve(known);
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
    const deadline = Date.now() + GEOCODE_BUDGET_MS;
    const worker = async () => {
      while (next < places.length && Date.now() < deadline) {
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
        const hits = await searchIndexWithRetry(q, centre);
        if (hits === null) break; // the index is down; Nominatim below still gets its one try
        const hit = hits.find((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng) && near(h));
        if (hit) return { lat: hit.lat, lng: hit.lng };
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

/**
 * One TREK index search, retried once after a short pause.
 *
 * Four parallel workers on a long document hit the index's rate limit, and the
 * first version gave up on the whole place at the first refusal — which is how
 * 旭山動物園 came back "not on the map" although the index knows it.
 * @param {string} q - Search text.
 * @param {LatLng | null} centre - City centre to bias towards, when known.
 * @returns {Promise<Array<{lat:number,lng:number}> | null>} Hits, or null when the index stayed unreachable.
 */
async function searchIndexWithRetry(q: string, centre: LatLng | null): Promise<{ lat: number; lng: number }[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await trekPlacesSearch(q, { limit: 5, ...(centre ?? {}) });
    } catch (err) {
      console.warn(`[itinerary-import] place index search failed (attempt ${attempt + 1}) for "${q}":`, err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return null;
}

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
