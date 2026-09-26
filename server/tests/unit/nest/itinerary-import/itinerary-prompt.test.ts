import { describe, it, expect } from 'vitest';
import {
  buildItinerarySystemPrompt,
  normalizeExtraction,
  normalizeTime,
} from '../../../../src/nest/itinerary-import/itinerary-prompt';
import { composeNotes, distanceKm, nameQueries } from '../../../../src/nest/itinerary-import/itinerary-import.service';

describe('buildItinerarySystemPrompt', () => {
  it('lists the trip days the plan may use', () => {
    const prompt = buildItinerarySystemPrompt('北海道冰雪祭2027', [
      { day_number: 1, date: '2027-02-03', title: null },
      { day_number: 2, date: '2027-02-04', title: '札幌' },
    ]);
    expect(prompt).toContain('Day 1 (2027-02-03)');
    expect(prompt).toContain('Day 2 (2027-02-04) — 札幌');
    expect(prompt).toContain('北海道冰雪祭2027');
  });

  it('says so when the trip has no days', () => {
    expect(buildItinerarySystemPrompt('Trip', [])).toContain('(the trip has no days yet)');
  });
});

describe('normalizeTime', () => {
  it.each([
    ['19:00', '19:00'],
    ['7:00pm', '19:00'],
    ['7pm', '19:00'],
    ['12:30am', '00:30'],
    ['0830', '08:30'],
    ['9：15', '09:15'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeTime(input)).toBe(expected);
  });

  it.each([['25:00'], ['tonight'], [''], [null], [1900]])('rejects %s', (input) => {
    expect(normalizeTime(input)).toBeNull();
  });
});

describe('normalizeExtraction', () => {
  it('coerces fields, defaults unknown categories and drops nameless entries', () => {
    const out = normalizeExtraction({
      places: [
        { key: 'p1', name: '米久本店', category: 'Restaurant', tentative: 'true', meal: 'Lunch', time: '12pm', rating: 'Tabelog 3.67' },
        { key: 'p2', name: '弘前城', category: 'castle' },
        { key: 'p3', category: 'restaurant' },
        'not an object',
      ],
    });
    expect(out.places).toHaveLength(2);
    expect(out.places[0]).toMatchObject({ key: 'p1', category: 'restaurant', tentative: true, meal: 'lunch', time: '12:00', rating: 'Tabelog 3.67' });
    expect(out.places[1]).toMatchObject({ key: 'p2', category: 'other', tentative: false, meal: null });
  });

  it('makes duplicate keys unique', () => {
    const out = normalizeExtraction({ places: [{ key: 'p1', name: 'A' }, { key: 'p1', name: 'B' }] });
    expect(new Set(out.places.map((p) => p.key)).size).toBe(2);
  });

  it('keeps a place on one day only, never plans hotels, and drops unknown keys', () => {
    const out = normalizeExtraction({
      places: [
        { key: 'p1', name: 'Hotel', category: 'hotel' },
        { key: 'p2', name: 'Sight', category: 'attraction' },
        { key: 'p3', name: 'Dinner', category: 'restaurant' },
      ],
      plan: [
        { day_number: 1, place_keys: ['p1', 'p2', 'p9'] },
        { day_number: 2, place_keys: ['p2', 'p3'] },
        { day_number: 'x', place_keys: ['p3'] },
      ],
    });
    expect(out.plan).toEqual([
      { day_number: 1, place_keys: ['p2'] },
      { day_number: 2, place_keys: ['p3'] },
    ]);
  });

  it('survives an answer with nothing usable in it', () => {
    expect(normalizeExtraction(null)).toEqual({ places: [], plan: [], todos: [], cities: new Map() });
    expect(normalizeExtraction({ places: 'nope', plan: {}, todos: [1, '', ' check hotel '] }).todos).toEqual(['1', 'check hotel']);
  });
});

describe('normalizeExtraction cities', () => {
  it('keeps valid city centres and drops broken ones', () => {
    const out = normalizeExtraction({
      places: [],
      cities: [
        { name: '旭川', lat: 43.77, lng: 142.37 },
        { name: 'Nowhere', lat: 0, lng: 0 },
        { name: 'Bad', lat: 'x', lng: 1 },
        { name: 'Far', lat: 123, lng: 1 },
        'nope',
      ],
    });
    expect([...out.cities.entries()]).toEqual([['旭川', { lat: 43.77, lng: 142.37 }]]);
  });
});

describe('nameQueries', () => {
  it('tries the local name first, then the short query, then the name without brackets', () => {
    expect(
      nameQueries({ name: 'Tonkatsu Yamabe (とんかつ山家)', local_name: 'とんかつ山家', geocode_query: 'とんかつ山家' }),
    ).toEqual(['とんかつ山家', 'Tonkatsu Yamabe', 'Tonkatsu Yamabe (とんかつ山家)']);
  });

  it('never asks more than three times', () => {
    expect(nameQueries({ name: 'A (x)', local_name: 'B', geocode_query: 'C' })).toHaveLength(3);
  });
});

describe('distanceKm', () => {
  it('measures Sapporo to Otaru at roughly 30 km', () => {
    const d = distanceKm({ lat: 43.0618, lng: 141.3545 }, { lat: 43.1907, lng: 140.9947 });
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(40);
  });
});

describe('composeNotes', () => {
  it('puts the local name, rating, hours and notes on separate lines', () => {
    expect(
      composeNotes({ name: 'Yonekyu', local_name: '米久本店', rating: 'Tabelog 3.67', opening_hours: '11:30–21:00', notes: '壽喜燒' }),
    ).toBe('米久本店\n⭐ Tabelog 3.67\n🕒 11:30–21:00\n壽喜燒');
  });

  it('is null when there is nothing to say', () => {
    expect(composeNotes({ name: 'X', local_name: 'X', rating: null, opening_hours: null, notes: '  ' })).toBeNull();
  });
});
