/**
 * @file        itineraryImportUiStore.test.ts
 * @description Unit tests for the AI itinerary import dialog UI store.
 * @module      client/store
 * @layer       frontend
 * @dependencies vitest; store/itineraryImportUiStore
 * @author      Claude (AI) for project owner
 * @created     2026-09-27
 * @lastModified 2026-09-27 — Initial version. (see CHANGELOG.md)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useItineraryImportUi } from './itineraryImportUiStore'

describe('useItineraryImportUi', () => {
  beforeEach(() => useItineraryImportUi.setState({ tripId: null }))

  it('starts closed', () => {
    expect(useItineraryImportUi.getState().tripId).toBeNull()
  })

  it('opens for a trip and closes again', () => {
    useItineraryImportUi.getState().open(7)
    expect(useItineraryImportUi.getState().tripId).toBe(7)
    useItineraryImportUi.getState().close()
    expect(useItineraryImportUi.getState().tripId).toBeNull()
  })

  it('switches to another trip when opened again', () => {
    useItineraryImportUi.getState().open(7)
    useItineraryImportUi.getState().open(9)
    expect(useItineraryImportUi.getState().tripId).toBe(9)
  })
})
