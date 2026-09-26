import { Module } from '@nestjs/common';
import { ItineraryImportController } from './itinerary-import.controller';
import { ItineraryImportService } from './itinerary-import.service';
import { LlmParseModule } from '../llm-parse/llm-parse.module';
import { MapsModule } from '../maps/maps.module';
import { PlacesModule } from '../places/places.module';
import { AssignmentsDomainModule } from '../assignments/assignments-domain.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AddonsModule } from '../addons/addons.module';
import { AuthModule } from '../auth/auth.module';

/** Planning document → places + Plan A, on the configured AI model. */
@Module({
  imports: [LlmParseModule, MapsModule, PlacesModule, AssignmentsDomainModule, PermissionsModule, AddonsModule, AuthModule],
  controllers: [ItineraryImportController],
  providers: [ItineraryImportService],
})
export class ItineraryImportModule {}
