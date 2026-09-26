import type { ResolvedLlmConfig } from '../llm-parse/llm-config';
import { parseLenientJson } from '../llm-parse/lenient-json';
import { safeFetchLlm } from '../../utils/ssrfGuard';
import { readEnv } from '../../app-config';

/**
 * A two-week plan with an appendix is a hundred-odd places, and a thinking
 * model (Gemini 3.x) spends part of the budget before it writes a word, so the
 * first request asks for a lot. A server that caps lower says so with a 400,
 * and the ladder below retries at the fallback.
 */
const MAX_TOKENS = 65536;
const FALLBACK_MAX_TOKENS = 16384;
const ANTHROPIC_VERSION = '2023-06-01';
/** Overloaded / rate-limited answers worth waiting out: Gemini returns 503 under load. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [3000, 10000];

/**
 * One JSON-answering call to whichever provider the instance is configured for.
 *
 * The booking importer's clients are welded to its reservation schema (tool
 * names, `reservations` unwrapping), so this is the small generic sibling: a
 * system prompt, a user text, and whatever JSON object the model answers with.
 * The provider plumbing is the same — `safeFetchLlm` for the SSRF guard and the
 * configured timeout, `parseLenientJson` for Gemini's JSON5-ish output.
 */
export async function completeJson(config: ResolvedLlmConfig, system: string, user: string): Promise<unknown> {
  const content = await withBusyFallback(config, (c) => (c.provider === 'anthropic' ? anthropic(c, system, user) : openAiCompatible(c, system, user)));
  if (!content?.trim()) throw new Error('the model returned an empty response');
  const parsed = parseLenientJson(content) ?? parseLenientJson(extractJsonObject(content));
  if (!parsed || typeof parsed !== 'object') throw new Error('the model did not answer with JSON');
  return parsed;
}

async function openAiCompatible(config: ResolvedLlmConfig, system: string, user: string): Promise<string | undefined> {
  const base = (config.baseUrl ?? (config.provider === 'local' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1')).replace(/(?<!\/)\/+$/, '');
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    // Extraction needs little deliberation; on a thinking model this keeps the
    // reasoning from eating the output budget. Dropped if a server rejects it.
    reasoning_effort: 'low',
  };

  // Same 400 ladder as the booking client, extended with the remedies the
  // bigger budget and the reasoning hint can provoke.
  const tokenKey = () => ('max_tokens' in body ? 'max_tokens' : 'max_completion_tokens');
  let res = await send(`${base}/chat/completions`, body, { authorization: config.apiKey ? `Bearer ${config.apiKey}` : undefined });
  for (let i = 0; i < 5 && res.status === 400; i++) {
    const detail = await res.text().catch(() => '');
    if (/reasoning/i.test(detail) && 'reasoning_effort' in body) {
      delete body.reasoning_effort;
    } else if (/max_(completion_)?tokens/.test(detail) && /(too large|maximum|at most|exceed|less than|range)/i.test(detail) && body[tokenKey()] !== FALLBACK_MAX_TOKENS) {
      body[tokenKey()] = FALLBACK_MAX_TOKENS;
    } else if (detail.includes('max_completion_tokens') && 'max_tokens' in body) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    } else if (/temperature/i.test(detail) && 'temperature' in body) {
      delete body.temperature;
    } else if ('response_format' in body) {
      delete body.response_format;
    } else {
      throw new Error(`AI request failed (400): ${detail.slice(0, 300)}`);
    }
    res = await send(`${base}/chat/completions`, body, { authorization: config.apiKey ? `Bearer ${config.apiKey}` : undefined });
  }
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error('the answer was cut off — the document is too long for one pass');
  return data.choices?.[0]?.message?.content;
}

async function anthropic(config: ResolvedLlmConfig, system: string, user: string): Promise<string | undefined> {
  const base = (config.baseUrl ?? 'https://api.anthropic.com').replace(/(?<!\/)\/+$/, '');
  const res = await send(
    `${base}/v1/messages`,
    { model: config.model, max_tokens: 32000, system, messages: [{ role: 'user', content: user }] },
    { 'x-api-key': config.apiKey ?? '', 'anthropic-version': ANTHROPIC_VERSION },
  );
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (data.stop_reason === 'max_tokens') throw new Error('the answer was cut off — the document is too long for one pass');
  return data.content?.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

/** The provider stayed overloaded through every retry. */
class AiBusyError extends Error {}

/**
 * Gemini's newest Flash is regularly "experiencing high demand" for minutes at
 * a time, while the previous generation answers. On Google's endpoint only, a
 * busy configured model steps down to these before the import gives up.
 */
const GEMINI_BUSY_FALLBACKS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];

async function withBusyFallback<T>(config: ResolvedLlmConfig, call: (c: ResolvedLlmConfig) => Promise<T>): Promise<T> {
  const isGemini = (config.baseUrl ?? '').includes('generativelanguage.googleapis.com');
  const models = [config.model, ...(isGemini ? GEMINI_BUSY_FALLBACKS.filter((m) => m !== config.model) : [])];
  for (let i = 0; ; i++) {
    try {
      return await call({ ...config, model: models[i] });
    } catch (err) {
      if (!(err instanceof AiBusyError) || i >= models.length - 1) throw err;
      console.warn(`[itinerary-import] ${models[i]} is busy, falling back to ${models[i + 1]}`);
    }
  }
}

/** POST with the configured timeout, retrying briefly while the provider is overloaded. */
async function send(url: string, body: unknown, headers: Record<string, string | undefined>): Promise<Response> {
  const cleanHeaders: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(headers)) if (v) cleanHeaders[k] = v;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), readEnv().integrations.llmTimeoutMs);
    let res: Response;
    try {
      res = await safeFetchLlm(url, { method: 'POST', signal: controller.signal, headers: cleanHeaders, body: JSON.stringify(body) });
    } finally {
      clearTimeout(timer);
    }
    if (!RETRYABLE.has(res.status)) return res;
    if (attempt >= RETRY_DELAYS_MS.length) {
      // Still overloaded after waiting: say so plainly instead of relaying the
      // provider's JSON, and name the one thing the traveller can change.
      await res.text().catch(() => '');
      throw new AiBusyError(`the AI service is busy (${res.status}). Try again in a minute, or choose a lighter model under Admin → Addons → AI Parsing.`);
    }
    await res.text().catch(() => '');
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
}

/** The outermost {...} of an answer that wrapped its JSON in prose. */
function extractJsonObject(content: string): string {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return start >= 0 && end > start ? content.slice(start, end + 1) : '';
}
