# Lessons Learned — TREK fork

> Mistakes specific to this project. Format and rules: `~/.claude/standards/dev-standards.md` §6.
> Global lessons (any project): `~/.claude/standards/lessons-learned.md`.
> Last updated: 2026-09-27

---

### L-2026-09-26-01 · AI import failed every time on the owner's machine
- **Symptom:** The owner tried the AI itinerary import 3–4 times; every "Analyse" failed ("cannot connect", 502). Claude's own curl tests had passed.
- **Root cause:** In `npm run dev`, `server/scripts/dev.mjs` runs `node --watch`. On Windows, the first `require` of a lazily loaded dependency (`undici`'s llhttp wasm, `iconv-lite` via mammoth) is reported as a file change, so the API restarted in the middle of each import request. Claude's tests passed only because those modules were already warm.
- **Fix:** `npm run start:local` (build once, `node dist/index.js` without `--watch`); `start-trek.bat` uses it (commit `a0519ca60`).
- **Prevention:** Test scenarios §0.1 require `start:local` for manual testing. Any end-to-end check first counts `TREK API started` in the log before and after the request; a second start means the run is invalid.
- **Scope:** project (the `node --watch` part is also in the global log)

### L-2026-09-26-02 · Phone file picker greyed out Word and Excel files
- **Symptom:** On the phone, "Upload file" would not let the owner pick `.docx` / `.xlsx`.
- **Root cause:** `<input accept>` listed only extensions; iOS Files and several Android pickers match on MIME type.
- **Fix:** `ItineraryImportModal.tsx` `ACCEPT` now lists both extensions and MIME types.
- **Prevention:** A browser check asserts that `input.accept` contains the Word and Excel MIME types, and a real file is attached with `DataTransfer` in the phone viewport before handing over.
- **Scope:** project (general rule in the global log)

### L-2026-09-26-03 · Places in Asahikawa never found on the map
- **Symptom:** 旭山動物園 and every other 旭川 place came back "Not on map".
- **Root cause:** The city centre came from a bare-name Nominatim lookup; "旭川" resolved to a namesake in Akita, 480 km away, and the 60 km radius filter then rejected every real hit.
- **Fix:** The AI returns `cities[]` with centre coordinates, which is preferred; Nominatim is only a fallback (`itinerary-prompt.ts`, `itinerary-import.service.ts`).
- **Prevention:** Unit test `normalizeExtraction cities`. Test scenario TC-05 expects Asahikawa places to be located.
- **Scope:** project

### L-2026-09-26-04 · Blank app after editing a shared locale file
- **Symptom:** The app would not load ("module does not provide an export named 'default'").
- **Root cause:** While `npm run dev` was running, Claude edited `shared/src/i18n`. The `shared` watcher rewrote `dist/` while Vite was reading it, and Vite cached the half-written module.
- **Fix:** Restarted the dev servers.
- **Prevention:** After changing anything in `shared/`, wait until `dist` contains the new key, then restart Vite before telling the owner to reload. `start:local` does not watch `shared`, so this cannot happen during the owner's testing.
- **Scope:** project

### L-2026-09-26-05 · API key pasted into the Base URL field
- **Symptom:** Every AI call failed with "Invalid URL".
- **Root cause:** The admin AI Parsing form accepted any text as the Base URL, and the owner pasted the key there. Earlier instructions from Claude also named the wrong key format (`AIza…`), which added to the confusion.
- **Fix:** `AddonManager.tsx` refuses a non-`http(s)://` Base URL, with an inline hint. The test scenarios state that AI Studio keys start with `AQ.`.
- **Prevention:** Form validation (automatic). Before describing an external credential's format, check the provider's current docs.
- **Scope:** project

### L-2026-09-26-06 · Rejected API key shown as raw JSON and retried pointlessly
- **Symptom:** The phone showed a raw Google JSON error, and the request was retried without `response_format` first.
- **Root cause:** The 400 retry ladder treated every 400 as a parameter problem.
- **Fix:** `isKeyProblem()` stops the ladder, and `providerError()` gives a plain message (commit `8e5460e3a`).
- **Prevention:** Unit tests in `itinerary-llm.test.ts`. Test scenario TC-11.
- **Scope:** project
