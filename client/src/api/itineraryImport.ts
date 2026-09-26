import apiClient, { postMultipart } from './client'
import type {
  ItineraryImportConfirmRequest,
  ItineraryImportConfirmResponse,
  ItineraryImportPreviewResponse,
} from '@trek/shared'

/**
 * Planning document → candidate places + Plan A, on the configured AI model.
 *
 * Deliberately online-only: the work is an AI call and a round of geocoding,
 * neither of which has an offline answer, and nothing is written until the
 * confirm call. The confirmed places reach the offline cache through the
 * trip reload that follows, like the other bulk imports.
 */
export const itineraryImportApi = {
  preview: (tripId: number | string, source: { file?: File; text?: string }, signal?: AbortSignal): Promise<ItineraryImportPreviewResponse> => {
    const fd = new FormData()
    if (source.file) fd.append('file', source.file)
    else fd.append('text', source.text ?? '')
    // Multipart even for pasted text, so both arrive on one route; no timeout,
    // a long document can keep the model busy for minutes.
    return postMultipart(`/trips/${tripId}/itinerary-import/preview`, fd, { signal })
  },
  confirm: (tripId: number | string, body: ItineraryImportConfirmRequest): Promise<ItineraryImportConfirmResponse> =>
    apiClient.post(`/trips/${tripId}/itinerary-import/confirm`, body, { timeout: 120000 }).then(r => r.data),
}
