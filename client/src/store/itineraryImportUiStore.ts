/**
 * @file        itineraryImportUiStore.ts
 * @description Which trip, if any, has the AI itinerary import dialog open.
 *              The dialog is rendered once at the app root (ItineraryImportHost), not
 *              inside the planner: importing reloads the trip, and loadTrip unmounts
 *              the planner while it loads — a dialog living there vanished before it
 *              could show its result / undo step. Same pattern as the save-to-collection modal.
 * @module      client/store
 * @layer       frontend
 * @dependencies zustand
 * @author      Claude (AI) for project owner
 * @created     2026-09-27
 * @lastModified 2026-09-27 — Initial version. (see CHANGELOG.md)
 */
import { create } from 'zustand'

interface ItineraryImportUiState {
  /** Trip whose import dialog is open, or null when closed. */
  tripId: number | null
  /**
   * Open the dialog for a trip.
   * @param {number} tripId - Trip to import into.
   */
  open: (tripId: number) => void
  /** Close the dialog. */
  close: () => void
}

export const useItineraryImportUi = create<ItineraryImportUiState>((set) => ({
  tripId: null,
  open: (tripId) => set({ tripId }),
  close: () => set({ tripId: null }),
}))
