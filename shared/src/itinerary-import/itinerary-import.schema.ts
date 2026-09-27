/**
 * @file        itinerary-import.schema.ts
 * @description Zod contract for the AI itinerary import: preview, confirm and undo.
 * @module      shared/itinerary-import
 * @layer       shared
 * @dependencies zod
 * @author      Claude (AI) for project owner
 * @created     2026-09-26
 * @lastModified 2026-09-27 — Confirm returns the created ids; new undo request/response. (see CHANGELOG.md)
 */
import { z } from 'zod';

/**
 * Itinerary import contract — /api/trips/:tripId/itinerary-import.
 *
 * A traveller's own planning document (Word, Excel, PDF or pasted text) goes
 * through the configured AI model and comes back as a pool of candidate places
 * plus a first draft ("Plan A") spreading them over the trip's days. Nothing is
 * written until the traveller confirms the (possibly edited) preview.
 */

export const ITINERARY_IMPORT_CATEGORIES = [
  'restaurant',
  'cafe',
  'attraction',
  'shopping',
  'hotel',
  'nature',
  'activity',
  'transport',
  'other',
] as const;
export const itineraryImportCategorySchema = z.enum(ITINERARY_IMPORT_CATEGORIES);
export type ItineraryImportCategory = z.infer<typeof itineraryImportCategorySchema>;

export const ITINERARY_IMPORT_MEALS = ['breakfast', 'lunch', 'dinner'] as const;
export const itineraryImportMealSchema = z.enum(ITINERARY_IMPORT_MEALS);
export type ItineraryImportMeal = z.infer<typeof itineraryImportMealSchema>;

export const ITINERARY_IMPORT_EXTENSIONS = ['.docx', '.xlsx', '.pdf', '.txt', '.md', '.csv', '.html', '.htm', '.eml'] as const;

export const itineraryImportPlaceSchema = z.object({
  /** Stable id inside one preview; the plan refers to places by it. */
  key: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  /** The name in the destination's own language/script, when it differs. */
  local_name: z.string().max(200).nullish(),
  city: z.string().max(100).nullish(),
  area: z.string().max(100).nullish(),
  category: itineraryImportCategorySchema,
  notes: z.string().max(2000).nullish(),
  /** A review score as written, e.g. "Tabelog 3.67". */
  rating: z.string().max(60).nullish(),
  url: z.string().max(2000).nullish(),
  opening_hours: z.string().max(200).nullish(),
  /** Written with a question mark / "maybe" — imported with the tentative tag. */
  tentative: z.boolean(),
  meal: itineraryImportMealSchema.nullish(),
  /** "HH:MM" when the document gives a time. */
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});
export type ItineraryImportPlace = z.infer<typeof itineraryImportPlaceSchema>;

export const itineraryImportPlanDaySchema = z.object({
  day_id: z.number().int().positive(),
  place_keys: z.array(z.string().min(1).max(40)).max(50),
});
export type ItineraryImportPlanDay = z.infer<typeof itineraryImportPlanDaySchema>;

/** A plan day as the preview shows it: the day's label rides along for display. */
export const itineraryImportPreviewDaySchema = itineraryImportPlanDaySchema.extend({
  day_number: z.number().int(),
  date: z.string().nullable(),
  title: z.string().nullable(),
});
export type ItineraryImportPreviewDay = z.infer<typeof itineraryImportPreviewDaySchema>;

export const itineraryImportPreviewResponseSchema = z.object({
  places: z.array(itineraryImportPlaceSchema),
  plan: z.array(itineraryImportPreviewDaySchema),
  todos: z.array(z.string()),
  warnings: z.array(z.string()),
  truncated: z.boolean(),
});
export type ItineraryImportPreviewResponse = z.infer<typeof itineraryImportPreviewResponseSchema>;

export const itineraryImportConfirmRequestSchema = z.object({
  places: z.array(itineraryImportPlaceSchema).min(1).max(300),
  plan: z.array(itineraryImportPlanDaySchema).max(366).default([]),
  /** Localised name of the tag put on tentative places ("未決定"). */
  tentative_tag_name: z.string().min(1).max(50).default('Tentative'),
  /** To-dos from the document the traveller kept; added to the trip's to-do list. */
  todos: z.array(z.string().min(1).max(300)).max(100).default([]),
  /** Localised category the added to-dos are filed under. */
  todo_category: z.string().min(1).max(50).nullish(),
});
export type ItineraryImportConfirmRequest = z.input<typeof itineraryImportConfirmRequestSchema>;

const idListSchema = z.array(z.number().int().positive()).max(500);

export const itineraryImportConfirmResponseSchema = z.object({
  created: z.number(),
  skipped: z.number(),
  assigned: z.number(),
  todos_added: z.number(),
  /** Exactly what this import added, so it can be undone without touching anything else. */
  place_ids: idListSchema,
  assignment_ids: idListSchema,
  todo_ids: idListSchema,
});
export type ItineraryImportConfirmResponse = z.infer<typeof itineraryImportConfirmResponseSchema>;

/**
 * Undo one import: remove the rows it created and nothing else. Places that
 * already existed (the "skipped" ones) are never in these lists.
 */
export const itineraryImportUndoRequestSchema = z.object({
  place_ids: idListSchema.default([]),
  assignment_ids: idListSchema.default([]),
  todo_ids: idListSchema.default([]),
});
export type ItineraryImportUndoRequest = z.input<typeof itineraryImportUndoRequestSchema>;

export const itineraryImportUndoResponseSchema = z.object({
  places_removed: z.number(),
  assignments_removed: z.number(),
  todos_removed: z.number(),
});
export type ItineraryImportUndoResponse = z.infer<typeof itineraryImportUndoResponseSchema>;
