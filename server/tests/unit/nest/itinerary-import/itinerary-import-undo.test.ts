/**
 * @file        itinerary-import-undo.test.ts
 * @description Unit tests for ItineraryImportService.undo(): scoping, permissions,
 *              what gets deleted and what gets broadcast. Collaborators are fakes.
 * @module      server/tests/itinerary-import
 * @layer       backend
 * @dependencies vitest; src/nest/itinerary-import/itinerary-import.service
 * @author      Claude (AI) for project owner
 * @created     2026-09-27
 * @lastModified 2026-09-27 — Initial version. (see CHANGELOG.md)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ItineraryImportService } from '../../../../src/nest/itinerary-import/itinerary-import.service';

type Fn = ReturnType<typeof vi.fn>;

function build(opts: { canDayEdit?: boolean; canPackingEdit?: boolean; tripFound?: boolean } = {}) {
  const { canDayEdit = true, canPackingEdit = true, tripFound = true } = opts;
  const dbs = {
    canAccessTrip: vi.fn(() => (tripFound ? { id: 7, user_id: 1 } : undefined)),
    // Only stop 31 belongs to trip 7; 99 is from another trip and is not returned.
    all: vi.fn(() => [{ id: 31, day_id: 5 }]),
    transaction: vi.fn((fn: () => unknown) => fn()),
  };
  const places = {
    scopedIds: vi.fn((_trip: string, ids: number[]) => ids.filter((id) => id !== 999)),
    onDeleted: vi.fn(),
    linkedExpenseIds: vi.fn(() => [44]),
    removeMany: vi.fn(async (_trip: string, ids: number[]) => ({ deleted: ids, cancelled: { reservationIds: [], budgetItemIds: [] } })),
    broadcast: vi.fn(),
  };
  const assignments = { deleteAssignment: vi.fn(), broadcast: vi.fn(), reconcile: vi.fn() };
  const todo = { deleteItem: vi.fn((_trip: string, id: number) => id !== 404), broadcast: vi.fn() };
  const permissions = {
    checkPermission: vi.fn((action: string) => (action === 'day_edit' ? canDayEdit : action === 'packing_edit' ? canPackingEdit : true)),
  };
  const service = new ItineraryImportService(
    dbs as never, {} as never, {} as never, places as never, assignments as never, permissions as never, todo as never,
  );
  return { service, dbs, places, assignments, todo };
}

const user = { id: 1, role: 'user' } as never;

describe('ItineraryImportService.undo', () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => {
    t = build();
  });

  it('removes only in-trip places, the listed stops and the to-dos, and reports counts', async () => {
    const res = await t.service.undo('7', user, { place_ids: [11, 12, 999], assignment_ids: [31, 99], todo_ids: [3, 404] });

    expect(t.places.scopedIds).toHaveBeenCalledWith('7', [11, 12, 999]);
    expect(t.places.removeMany).toHaveBeenCalledWith('7', [11, 12]);
    expect((t.assignments.deleteAssignment as Fn).mock.calls).toEqual([[31]]);
    expect(res).toEqual({ places_removed: 2, assignments_removed: 1, todos_removed: 1 });
  });

  it('broadcasts every deletion so other devices drop the rows', async () => {
    await t.service.undo('7', user, { place_ids: [11], assignment_ids: [31], todo_ids: [3] }, 'sock');

    expect(t.places.broadcast).toHaveBeenCalledWith('7', 'place:deleted', { placeId: 11 }, 'sock');
    expect(t.places.broadcast).toHaveBeenCalledWith('7', 'budget:deleted', { itemId: 44 }, undefined);
    expect(t.assignments.broadcast).toHaveBeenCalledWith('7', 'assignment:deleted', { assignmentId: 31, dayId: 5 }, 'sock');
    expect(t.todo.broadcast).toHaveBeenCalledWith('7', 'todo:deleted', { itemId: 3 }, 'sock');
    expect(t.assignments.reconcile).toHaveBeenCalledWith('7', 'sock');
  });

  it('reads the stops before deleting places (the FK cascade would hide them)', async () => {
    await t.service.undo('7', user, { place_ids: [11], assignment_ids: [31], todo_ids: [] });
    const readOrder = (t.dbs.all as Fn).mock.invocationCallOrder[0];
    const deleteOrder = (t.places.removeMany as Fn).mock.invocationCallOrder[0];
    expect(readOrder).toBeLessThan(deleteOrder);
  });

  it('does not query stops when none were created', async () => {
    await t.service.undo('7', user, { place_ids: [11], assignment_ids: [], todo_ids: [] });
    expect(t.dbs.all).not.toHaveBeenCalled();
    expect(t.assignments.reconcile).not.toHaveBeenCalled();
  });

  it('404s for a trip the caller cannot access', async () => {
    const x = build({ tripFound: false });
    await expect(x.service.undo('7', user, { place_ids: [1], assignment_ids: [], todo_ids: [] })).rejects.toMatchObject({ status: 404 });
    expect(x.places.removeMany).not.toHaveBeenCalled();
  });

  it('403s before deleting anything when day_edit or packing_edit is missing', async () => {
    const noDay = build({ canDayEdit: false });
    await expect(noDay.service.undo('7', user, { place_ids: [1], assignment_ids: [31], todo_ids: [] })).rejects.toMatchObject({ status: 403 });
    expect(noDay.places.removeMany).not.toHaveBeenCalled();

    const noTodo = build({ canPackingEdit: false });
    await expect(noTodo.service.undo('7', user, { place_ids: [1], assignment_ids: [], todo_ids: [3] })).rejects.toMatchObject({ status: 403 });
    expect(noTodo.places.removeMany).not.toHaveBeenCalled();
  });
});
