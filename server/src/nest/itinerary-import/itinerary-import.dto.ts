/**
 * @file        itinerary-import.dto.ts
 * @description Nest DTOs (Zod-backed) for the itinerary import routes.
 * @module      server/nest/itinerary-import
 * @layer       backend
 * @dependencies nestjs-zod; @trek/shared itinerary-import schema
 * @author      Claude (AI) for project owner
 * @created     2026-09-26
 * @lastModified 2026-09-27 — Added ItineraryImportUndoDto. (see CHANGELOG.md)
 */
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { itineraryImportConfirmRequestSchema, itineraryImportUndoRequestSchema } from '@trek/shared';

/**
 * Preview is multipart: either a `file` or a pasted `text` field, both strings
 * as far as the form is concerned. Not strict, because browsers add fields.
 */
export class ItineraryImportPreviewDto extends createZodDto(z.object({ text: z.string().max(200_000).optional() })) {}

export class ItineraryImportConfirmDto extends createZodDto(itineraryImportConfirmRequestSchema) {}

export class ItineraryImportUndoDto extends createZodDto(itineraryImportUndoRequestSchema) {}
