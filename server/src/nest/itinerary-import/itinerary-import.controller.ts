import { Body, Controller, Headers, HttpCode, HttpException, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'node:path';
import { ITINERARY_IMPORT_EXTENSIONS, type ItineraryImportConfirmResponse, type ItineraryImportPreviewResponse } from '@trek/shared';
import type { User } from '../../types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission, TripAccessGuard } from '../permissions/trip-access.guard';
import { AddonGuard } from '../addons/addon.guard';
import { RequireAddon } from '../addons/require-addon.decorator';
import { ADDON_IDS } from '../../addons';
import { ItineraryImportService } from './itinerary-import.service';
import { ItineraryImportConfirmDto, ItineraryImportPreviewDto } from './itinerary-import.dto';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED = new Set<string>(ITINERARY_IMPORT_EXTENSIONS);

/**
 * Planning document → candidate places + Plan A. Rides on the AI Parsing addon:
 * it is the same configured model, so with the addon off the route 404s like
 * every other addon route (AddonGuard first, before the 401).
 */
@Controller('api/trips/:tripId/itinerary-import')
@UseGuards(AddonGuard, JwtAuthGuard, TripAccessGuard)
@RequireAddon(ADDON_IDS.LLM_PARSING, 'AI Parsing')
export class ItineraryImportController {
  constructor(private readonly service: ItineraryImportService) {}

  @Post('preview')
  @HttpCode(200)
  @RequirePermission('place_edit')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 }, defParamCharset: 'utf8' }))
  async preview(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: ItineraryImportPreviewDto,
  ): Promise<ItineraryImportPreviewResponse> {
    if (file) {
      const ext = extname(file.originalname).toLowerCase();
      if (!ACCEPTED.has(ext)) {
        throw new HttpException({ error: `Unsupported file type: ${file.originalname}. Accepted: Word, Excel, PDF, text` }, 400);
      }
      return this.service.preview(tripId, user.id, { buffer: file.buffer, fileName: file.originalname });
    }
    if (!body?.text?.trim()) throw new HttpException({ error: 'Upload a file or paste some text' }, 400);
    return this.service.preview(tripId, user.id, { text: body.text });
  }

  @Post('confirm')
  @HttpCode(200)
  @RequirePermission('place_edit')
  confirm(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body() body: ItineraryImportConfirmDto,
    @Headers('x-socket-id') socketId?: string,
  ): ItineraryImportConfirmResponse {
    return this.service.confirm(tripId, user, body as never, socketId);
  }
}
