/**
 * @file        itinerary-prompt.ts
 * @description System prompt for the itinerary import and the normaliser that turns the model's
 *              answer into contract-valid places, Plan A days, to-dos and city centres.
 * @module      server/nest/itinerary-import
 * @layer       backend
 * @dependencies @trek/shared (itinerary-import schema)
 * @author      Claude (AI) for project owner
 * @created     2026-09-26
 * @lastModified 2026-09-26 — Ask the model for city centres to anchor geocoding. (see CHANGELOG.md)
 */
import {
  ITINERARY_IMPORT_CATEGORIES,
  ITINERARY_IMPORT_MEALS,
  itineraryImportPlaceSchema,
  type ItineraryImportCategory,
  type ItineraryImportMeal,
  type ItineraryImportPlace,
} from '@trek/shared';

export interface PromptDay {
  day_number: number;
  date: string | null;
  title: string | null;
}

/** An extracted place plus the two hints that never leave the server. */
export interface ExtractedPlace extends ItineraryImportPlace {
  geocode_query: string | null;
}

export interface ExtractedItinerary {
  places: ExtractedPlace[];
  plan: { day_number: number; place_keys: string[] }[];
  todos: string[];
  /** City name → approximate centre, as the model knows it. Anchors geocoding. */
  cities: Map<string, { lat: number; lng: number }>;
}

/**
 * Instructions for turning free-form planning notes into places + Plan A.
 *
 * Pure (no I/O) so it is unit-testable. The notes this was written against mix
 * day headings, hotel lines, train legs, "ask the hotel…" reminders, candidate
 * restaurant lists under "dinner?" and an appendix of restaurants tied to no day
 * — hence the explicit rules for tentative alternatives and unplanned extras.
 */
export function buildItinerarySystemPrompt(tripTitle: string, days: PromptDay[]): string {
  const dayList = days.length
    ? days.map((d) => `  Day ${d.day_number}${d.date ? ` (${d.date})` : ''}${d.title ? ` — ${d.title}` : ''}`).join('\n')
    : '  (the trip has no days yet)';
  return [
    "You turn a traveller's personal trip-planning notes into structured data for a travel planner.",
    'Answer with ONLY one JSON object, no prose, no markdown fence, of this exact shape:',
    '{"places":[{"key":"p1","name":"","local_name":null,"city":null,"area":null,"category":"restaurant","notes":null,"rating":null,"url":null,"opening_hours":null,"tentative":false,"meal":null,"time":null,"source_day":null,"geocode_query":""}],',
    ' "plan":[{"day_number":1,"place_keys":["p1"]}],',
    ' "todos":[""],',
    ' "cities":[{"name":"旭川","lat":43.77,"lng":142.37}]}',
    'Leave out any field whose value would be null or false, to keep the answer short.',
    '',
    'PLACES — every distinct restaurant, cafe, sight, shop, market, museum, park, hotel or activity the notes mention:',
    '- One entry per real place; merge duplicates. Keys are "p1", "p2", … in order of first mention.',
    '- Do NOT create places for flights, train/bus legs, or stations and airports only used to change trains.',
    `- category: one of ${ITINERARY_IMPORT_CATEGORIES.join(', ')}.`,
    '- name: as the notes write it (keep their language). local_name: the name in the destination\'s own script (e.g. とんかつ山家, スープカレー GARAKU, 小樽運河) — from the notes, or the well-known local name when you are sure of it; null if unsure. Never invent places.',
    '- city: ALWAYS give it (e.g. "東京", "弘前", "青森"), inferred from the day heading, hotel or surrounding entries. area: the district when known (e.g. "上野").',
    '- notes: at most 120 characters in the notes\' language — cuisine, what to order, queue/booking tips, "已訂 19:00", award lists such as 百名店2025.',
    '- rating: a review score as written, e.g. "Tabelog 3.67". url: the most useful link given for it (Tabelog, official site, Google Maps), copied exactly.',
    '- opening_hours: as written, e.g. "09:00–17:00".',
    '- tentative: true when the notes mark it with ?, ？, "maybe", "or", or list it as one of several candidates (e.g. several restaurants under "dinner?").',
    `- meal: one of ${ITINERARY_IMPORT_MEALS.join(', ')} when it is meant for that meal, else null. time: "HH:MM" (24h) for a booked or fixed time, else null.`,
    '- source_day: the 1-based day number in the notes\' own day-by-day structure where it appears, or null when it is not under a day (appendix lists, general ideas).',
    '- geocode_query: the shortest distinctive name a local map search would know it by, in the local script, without the city (e.g. "米久本店", "GARAKU", "二条市場").',
    '',
    'CITIES — one entry for every distinct city used in "places", with its approximate centre coordinates (decimal degrees). Use the city the notes actually mean, in the country/region they are about, never a namesake elsewhere.',
    '',
    'TODOS — short action items and reminders from the notes (check, ask, book, buy, confirm…), in the notes\' language, with the date/day when known. Not places.',
    '',
    `PLAN A — a first draft spreading places over the trip "${tripTitle}", whose days are:`,
    dayList,
    '- If the notes have their own day-by-day structure, keep it: notes day N goes to trip Day N while both exist.',
    '- Places without a source day go to the day whose other places are in the same city/area; otherwise group them by area into sensible days.',
    '- At most one lunch and one dinner restaurant and about four other places per day. From several candidates for one meal, plan only the best rated; the rest stay unplanned.',
    '- Never plan hotels. Order each day as a sensible route: morning sights, lunch, afternoon, dinner last.',
    '- Leave out anything that does not fit; never invent places. If the trip has no days, or its title clearly names a different destination than the notes, answer "plan": [].',
  ].join('\n');
}

export const ITINERARY_USER_PREFIX = 'Here are my trip-planning notes:\n\n';

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

function asCategory(v: unknown): ItineraryImportCategory {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (ITINERARY_IMPORT_CATEGORIES as readonly string[]).includes(s) ? (s as ItineraryImportCategory) : 'other';
}

function asMeal(v: unknown): ItineraryImportMeal | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (ITINERARY_IMPORT_MEALS as readonly string[]).includes(s) ? (s as ItineraryImportMeal) : null;
}

/** "7:00pm", "19:00", "1900" → "19:00"; anything else → null. */
export function normalizeTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().toLowerCase().match(/^(\d{1,2})[:：.]?(\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

/**
 * Whatever the model answered, reduced to what the contract allows.
 *
 * Each place is coerced field by field and then checked against the shared
 * schema, so one malformed entry costs that entry, not the import. Keys are
 * made unique here because the plan refers to them.
 */
export function normalizeExtraction(raw: unknown): ExtractedItinerary {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawPlaces = Array.isArray(obj.places) ? obj.places : [];
  const places: ExtractedPlace[] = [];
  const keyMap = new Map<string, string>();
  const used = new Set<string>();

  rawPlaces.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const r = p as Record<string, unknown>;
    const name = str(r.name, 200) ?? str(r.local_name, 200);
    if (!name) return;
    let key = str(r.key, 40) ?? `p${i + 1}`;
    if (used.has(key)) key = `p${i + 1}_${used.size}`;
    const candidate = {
      key,
      name,
      local_name: str(r.local_name, 200),
      city: str(r.city, 100),
      area: str(r.area, 100),
      category: asCategory(r.category),
      notes: str(r.notes, 2000),
      rating: str(r.rating, 60),
      url: str(r.url, 2000),
      opening_hours: str(r.opening_hours, 200),
      tentative: asBool(r.tentative),
      meal: asMeal(r.meal),
      time: normalizeTime(r.time),
      lat: null,
      lng: null,
    };
    const parsed = itineraryImportPlaceSchema.safeParse(candidate);
    if (!parsed.success) return;
    used.add(key);
    if (typeof r.key === 'string') keyMap.set(r.key.trim(), key);
    places.push({ ...parsed.data, geocode_query: str(r.geocode_query, 200) });
  });

  const known = new Set(places.map((p) => p.key));
  const hotels = new Set(places.filter((p) => p.category === 'hotel').map((p) => p.key));
  const planned = new Set<string>();
  const plan: ExtractedItinerary['plan'] = [];
  for (const d of Array.isArray(obj.plan) ? obj.plan : []) {
    if (!d || typeof d !== 'object') continue;
    const dayNumber = Number((d as Record<string, unknown>).day_number);
    const keys = (d as Record<string, unknown>).place_keys;
    if (!Number.isInteger(dayNumber) || !Array.isArray(keys)) continue;
    const place_keys: string[] = [];
    for (const k of keys) {
      const key = typeof k === 'string' ? (keyMap.get(k.trim()) ?? k.trim()) : '';
      // A place is on at most one day of Plan A, and hotels never are.
      if (!known.has(key) || hotels.has(key) || planned.has(key)) continue;
      planned.add(key);
      place_keys.push(key);
    }
    if (place_keys.length) plan.push({ day_number: dayNumber, place_keys });
  }

  const todos = (Array.isArray(obj.todos) ? obj.todos : [])
    .map((t) => str(t, 300))
    .filter((t): t is string => !!t)
    .slice(0, 100);

  const cities = new Map<string, { lat: number; lng: number }>();
  for (const c of Array.isArray(obj.cities) ? obj.cities : []) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const name = str(r.name, 100);
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (name && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      cities.set(name, { lat, lng });
    }
  }

  return { places, plan, todos, cities };
}
