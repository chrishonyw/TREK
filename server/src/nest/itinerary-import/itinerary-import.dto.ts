import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { itineraryImportConfirmRequestSchema } from '@trek/shared';

/**
 * Preview is multipart: either a `file` or a pasted `text` field, both strings
 * as far as the form is concerned. Not strict, because browsers add fields.
 */
export class ItineraryImportPreviewDto extends createZodDto(z.object({ text: z.string().max(200_000).optional() })) {}

export class ItineraryImportConfirmDto extends createZodDto(itineraryImportConfirmRequestSchema) {}
