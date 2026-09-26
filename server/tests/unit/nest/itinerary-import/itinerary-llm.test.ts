/**
 * @file        itinerary-llm.test.ts
 * @description Unit tests for the itinerary import's provider error mapping.
 * @module      server/tests/itinerary-import
 * @layer       backend
 * @dependencies vitest; src/nest/itinerary-import/itinerary-llm
 * @author      Claude (AI) for project owner
 * @created     2026-09-26
 * @lastModified 2026-09-26 — Initial version. (see CHANGELOG.md)
 */
import { describe, it, expect } from 'vitest';
import { isKeyProblem, providerError } from '../../../../src/nest/itinerary-import/itinerary-llm';

describe('isKeyProblem', () => {
  it.each([
    [400, '{"error":{"message":"Missing or invalid Authorization header."}}'],
    [400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
  ])('treats %s %s as a key problem', (status, detail) => {
    expect(isKeyProblem(status, detail)).toBe(true);
  });

  it('leaves parameter errors to the retry ladder', () => {
    expect(isKeyProblem(400, 'Unsupported parameter: max_tokens')).toBe(false);
  });
});

describe('providerError', () => {
  it('tells the traveller where to fix a rejected key', () => {
    expect(providerError(400, 'Missing or invalid Authorization header.').message).toContain('Admin → Addons → AI Parsing');
  });

  it('keeps the provider detail for other failures', () => {
    expect(providerError(500, 'boom').message).toBe('AI request failed (500): boom');
  });
});
