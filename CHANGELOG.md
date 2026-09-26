# Changelog

This file lists changes made in this **fork** (`chrishonyw/TREK`) only.
Upstream TREK changes are published as GitHub Releases at <https://github.com/liketrek/TREK/releases>.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- 2026-09-26 — AI itinerary import: upload a Word, Excel, PDF or text planning document (or paste notes) to extract places, to-dos and a "Plan A" day plan, with a preview to edit before saving. Available from the desktop places sidebar and the phone "Import Places" sheet.
- 2026-09-26 — Ticked to-dos from an imported document are added to the trip's to-do list.
- 2026-09-26 — `start-trek.bat` one-click start on Windows (installs with `--ignore-scripts`, since `better-sqlite3` ships a win32 prebuild).

### Changed
- 2026-09-26 — Vite dev server listens on all interfaces (`server.host: true`) so phones on the same Wi-Fi can connect.
- 2026-09-26 — Itinerary import: a rejected AI API key now shows "paste a valid key under Admin → Addons → AI Parsing" instead of the provider's raw JSON, and no longer retries the request with fewer parameters.

### Security
- 2026-09-26 — Note: `server.host: true` exposes the dev server to every device on the current network. See `docs/standards-audit-2026-09-26.md` §6.1.
