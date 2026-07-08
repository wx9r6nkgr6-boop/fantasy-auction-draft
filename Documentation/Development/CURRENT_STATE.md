# Current State

Last updated by Pass: FAD-2026-07-08-001

## Static Web App

- Status: Open
- Priority: High
- Known Issues: GitHub Pages is not enabled yet.
- Technical Debt: Single-file JavaScript keeps deployment simple but should be modularized if the app grows.
- Next Work: Add automated regression tests around state import/export and roster assignment.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `static-web-app`, `live-auction-ui`, `github-pages`
- Last Updating Pass: FAD-2026-07-08-001

## Sleeper Import

- Status: Open
- Priority: High
- Known Issues: Depends on Sleeper API availability and browser CORS behavior.
- Technical Debt: No offline bundled full player list; starter sample data is used until import succeeds.
- Next Work: Add last-good import timestamp display and optional cached import age warning.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `sleeper-import`
- Last Updating Pass: FAD-2026-07-08-001

## Draft State

- Status: Open
- Priority: High
- Known Issues: Undo only reverses the latest draft pick.
- Technical Debt: Roster assignment uses deterministic starter, flex, then bench allocation and does not support custom roster settings yet.
- Next Work: Add configurable roster rules after foundation stabilization.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `draft-state`
- Last Updating Pass: FAD-2026-07-08-001

## Player Prep

- Status: Open
- Priority: High
- Known Issues: Notes and tiers are local/exported state only and do not sync to external services.
- Technical Debt: Prep filter cache keys are simple string snapshots and may need a revision counter for very large edit sessions.
- Next Work: Add bulk prep import mapping if managers keep rankings in spreadsheets.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `player-prep`
- Last Updating Pass: FAD-2026-07-08-001

## Resolved Regression History

- FAD-2026-07-08-001: Established the first functional app surface; no prior app regressions existed in the GitHub repository.
- FAD-2026-07-08-001: Fixed Sleeper trending mismatch by preserving the all-player response map key as the player ID.
- FAD-2026-07-08-001: Replaced starter sample numeric IDs with synthetic IDs to prevent sample prep from attaching to real Sleeper players after refresh.

## Open Regression History

- FAD-2026-07-08-001: Requested commit `7efdba823b6c33c34476f0224c17a008d4b52ef2` was unavailable locally and remotely, so it could not be pushed.

## Verification And Deployment State

- Static syntax checks: `node --check app.js` passed.
- Browser testing: Passed in local in-app browser at `http://localhost:8080/`.
- Safari compatibility verification: Passed basic Safari load/title verification for `http://localhost:8080/`.
- JSON export/import verification: Passed direct Node verification of serialization and restore behavior.
- Sleeper import verification: Passed with 4,254 draftable players.
- Trending import verification: Passed with 75 visible trending cards after ID fix.
- Search/filter verification: Passed for notes search, position filtering, watch filtering, drafted filtering, and clear filters.
- Draft/undo verification: Passed with roster counter update and undo restoration.
- Autosave verification: Passed by restoring prep fields after browser reload.
- Responsive verification: Passed at iPad Pro 12.9 landscape `1366x1024` with no horizontal overflow.
- Xcode build: Intentionally not run; this repository has no Xcode project or native app target.
- iPhone deployment: Not applicable; static web app.
- iPad deployment: Not applicable; static web app. iPad Pro browser viewport verification passed.
- Apple Watch deployment: Not applicable; no Watch target.
