# Test Scenarios — AI Itinerary Import

- **Feature:** turn a planning document (Word / Excel / PDF / text) into places, to-dos and a "Plan A" day plan.
- **Branch:** `feature/itinerary-import`
- **Last updated:** 2026-09-26
- **Sample inputs:** `docs/guides/samples/sample-hokkaido-notes.txt`, `docs/guides/samples/sample-hokkaido-plan.xlsx`, and your own `東京青森12天.docx`.

---

## 0. Before you start (one-off)

| # | Step | Expected |
|---|---|---|
| 0.1 | On the computer, start TREK (`start-trek.bat`, or `npm run dev` in the repo root). | Terminal shows `TREK API started` and `Network: http://192.168.5.5:5173/`. |
| 0.2 | Admin → Addons → **AI Parsing**: switched on, Provider `OpenAI`, Base URL `https://generativelanguage.googleapis.com/v1beta/openai`, a **valid** Gemini API key, Model `gemini-3.5-flash`. Save. | "Saved" toast. |
| 0.3 | Phone: join the same Wi-Fi, open `http://192.168.5.5:5173`, log in. | Trip list shows. If the page never loads, turn off the Surfshark VPN (or allow LAN access) on phone and computer. |
| 0.4 | Tip: test on a **throwaway trip with dates** (e.g. "Test trip", 5 days), so imports do not clutter a real trip. | — |

## 1. Where the feature is

| Shell | Entry point |
|---|---|
| Desktop | Trip → **Plan** tab → left day-plan panel, top bar: **✨ AI import** (next to **Export**). |
| Desktop (2nd) | Right places sidebar (open it with the panel icon at the top right) → **✨ AI itinerary import** button under Import file / List Import. |
| Phone | Trip → bottom tab **Places** → round **✨** button at the top right (next to the ⬇ import icon). |
| Phone (2nd) | Places → ⬇ **Import Places** → **✨ AI itinerary import**. |

---

## 2. Scenarios

Each scenario: run it on **desktop** and on **phone** (the dialog is shared, so both should behave the same).

### TC-01 — Open and close the dialog
1. Open the dialog from each entry point in §1.
2. Tap **Cancel**, then the ✕, then the grey backdrop.

**Expected:** the dialog opens titled "Import a planning document"; each of the three closes it; nothing is saved.

### TC-02 — Paste text → places + Plan A (happy path)
1. Open the dialog → **Paste text**.
2. Paste the contents of `sample-hokkaido-notes.txt`.
3. Tap **Analyse** and wait (usually 20–60 s).

**Expected:**
- About 11–13 places listed with category icons (🍽️ ☕ 🏛️ 🛍️ …).
- "スープカレー GARAKU" shows `Tabelog 3.63`; "成吉思汗 だるま 本店" shows a **Dinner** badge.
- "白色戀人公園" and "政壽司 本店" show an **Undecided** badge (they end with `?`).
- Most places are found on the map; any that are not show a red **Not on map** badge.
- **Plan A** groups Sapporo places on one day and Otaru places on another.
- **To-dos** lists the two reminders, both ticked.

### TC-03 — Edit the preview, then import
1. Continue from TC-02.
2. Untick one place.
3. Change another place's day dropdown to a different day.
4. Untick one to-do.
5. Tap **Import N places**.

**Expected:**
- Toast: "N places imported, M added to days · 1 to-dos added".
- The unticked place is **not** in the trip.
- The moved place appears on the day you chose.
- Undecided places carry an orange **Undecided** tag.
- Place notes show the rating, for example `⭐ Tabelog 3.63`.
- Lists → To-do contains only the ticked to-do, under the "From document" category.

### TC-04 — Import without Plan A
1. Run TC-02 again on a fresh trip.
2. Switch **Add Plan A to the day plan** off, then import.

**Expected:** places are added to the places list, but no day gets new stops.

### TC-05 — Excel file
1. **Upload file** → choose `sample-hokkaido-plan.xlsx` (on the phone, pick it from Files / Drive) → **Analyse**.

**Expected:** Hakodate places on one day and Asahikawa places on another. "旭山動物園" keeps its 11:00 note, and the Lucky Pierrot place keeps its website link.

### TC-06 — Large Word file
1. **Upload file** → `東京青森12天 (1).docx` → **Analyse**. This can take a few minutes.

**Expected:**
- About 100+ places are found.
- The "晚飯? 上野食咩" candidates are marked Undecided with a Dinner badge.
- The to-dos include the JR / booking reminders.
- On a **Hokkaido** trip, Plan A is empty with the note that the document is about a different destination. That is correct behaviour.

### TC-07 — Re-import the same document (no duplicates)
1. Run TC-03, then import the same text again into the same trip.

**Expected:** the toast says "… already on the trip were skipped", and the places list has no duplicates.

### TC-08 — Wrong file type
1. **Upload file** → pick an image (.jpg) or a .zip.

**Expected:** either the file picker hides the file, or the error "Unsupported file type … Accepted: Word, Excel, PDF, text" appears. Nothing is saved.

### TC-09 — Empty input
1. **Paste text** and leave the box empty.

**Expected:** **Analyse** stays disabled.

### TC-10 — Stop while analysing
1. Start TC-06, then tap **Stop** while it is analysing.

**Expected:** you return to the input step; no error; nothing is saved.

### TC-11 — Bad / missing API key
1. Admin → AI Parsing → paste an obviously wrong key (e.g. `abc`) → Save → run TC-02.

**Expected:** the red message "the AI provider rejected the API key. Paste a valid key under Admin → Addons → AI Parsing." After this test, restore the real key.

### TC-12 — AI Parsing switched off
1. Admin → Addons → switch **AI Parsing** off → open the dialog.

**Expected:** a grey notice says AI is not set up, and **Analyse** is disabled. Switch it back on after the test.

### TC-13 — Gemini busy
This cannot be forced; note it if it happens.

**Expected:** with model `gemini-3.8-flash` under heavy load, the import either still succeeds (it falls back to `gemini-3.5-flash` automatically) or shows "the AI service is busy … Try again in a minute".

### TC-14 — Phone layout
1. On the phone, run TC-02 and scroll the preview.

**Expected:** nothing overflows the screen sideways; the day dropdowns are usable; the **Import** button stays visible at the bottom.

### TC-15 — Live sync to a second device
1. Keep the trip open on the computer.
2. Run TC-03 on the phone.

**Expected:** the new places and day stops appear on the computer without a manual refresh (reload once if not).

---

## 3. Reporting a problem

For any failed step, note the TC number, the device (desktop / phone), the step, and what you saw (a screenshot helps). Send it in chat.
