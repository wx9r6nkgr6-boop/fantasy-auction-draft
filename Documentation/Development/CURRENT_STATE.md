# Current State

Last updated by Pass: FAD-2026-07-08-002

## Static Web App

- Status: Open
- Priority: High
- Known Issues: GitHub Pages is not enabled yet.
- Technical Debt: Single-file JavaScript keeps deployment simple but should be modularized if the app grows.
- Next Work: Add automated regression tests around state import/export, ranking stability, roster assignment, and max-bid math.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `static-web-app`, `live-auction-ui`, `github-pages`
- Last Updating Pass: FAD-2026-07-08-002

## Sleeper Import

- Status: Open
- Priority: High
- Known Issues: Depends on Sleeper API availability and browser CORS behavior.
- Technical Debt: No offline bundled full player list; starter sample data is used until import succeeds. Fallback ranks depend on available Sleeper metadata and are intentionally not official rankings.
- Next Work: Add last-good import timestamp display, cached import age warning, and optional manual rank import.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `sleeper-import`, `fallback-rankings`
- Last Updating Pass: FAD-2026-07-08-002

## Draft State

- Status: Open
- Priority: High
- Known Issues: Undo only reverses the latest draft pick.
- Technical Debt: Roster assignment uses deterministic starter, flex, IR, then bench allocation and does not support custom roster settings yet.
- Next Work: Add configurable roster rules after foundation stabilization.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `draft-state`, `budget-max-bid`, `my-team`
- Last Updating Pass: FAD-2026-07-08-002

## Player Prep

- Status: Open
- Priority: High
- Known Issues: Notes, labels, and tiers are local/exported state only and do not sync to external services.
- Technical Debt: Prep filter cache keys are simple string snapshots and may need a revision counter for very large edit sessions.
- Next Work: Add bulk prep import mapping if managers keep rankings in spreadsheets.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `player-prep`, `chatgpt-helper`
- Last Updating Pass: FAD-2026-07-08-002

## My Team And Auction Guidance

- Status: Open
- Priority: High
- Known Issues: Scarcity warnings are intentionally simple and do not include projection systems, news, or advanced inflation.
- Technical Debt: Max-bid logic assumes $1 minimum bids and required roster slots excluding optional IR.
- Next Work: Add configurable roster settings and optional manual scoring notes for prompt generation.
- Related Epics: E-FAD-LIVE-AUCTION
- Architecture Tags: `my-team`, `budget-max-bid`, `fallback-rankings`, `chatgpt-helper`
- Last Updating Pass: FAD-2026-07-08-002

## Resolved Regression History

- FAD-2026-07-08-001: Established the first functional app surface; no prior app regressions existed in the GitHub repository.
- FAD-2026-07-08-001: Fixed Sleeper trending mismatch by preserving the all-player response map key as the player ID.
- FAD-2026-07-08-001: Replaced starter sample numeric IDs with synthetic IDs to prevent sample prep from attaching to real Sleeper players after refresh.
- FAD-2026-07-08-002: Fixed v2 autosave/import rank instability by reading both Sleeper snake_case fields and exported camelCase fields in the player normalizer.

## Open Regression History

- FAD-2026-07-08-001: Requested commit `7efdba823b6c33c34476f0224c17a008d4b52ef2` was unavailable locally and remotely, so it could not be pushed.
- FAD-2026-07-08-002: Fallback ranking quality is limited by Sleeper metadata; true projection/ranking feeds are still out of scope.

## Verification And Deployment State

- Static syntax checks: `node --check app.js` passed.
- Browser testing: Passed in local in-app browser at `http://localhost:8081/`.
- Safari compatibility verification: Passed basic Safari load/title verification in previous pass; this pass used in-app browser functional verification.
- JSON export/import verification: Passed direct Node verification of My Team, labels, tiers, team defenses, max bids, and roster state.
- Sleeper import verification: Passed with 612 core players and 1,157 cleaned players with deep pool enabled.
- Trending import verification: Passed with trending sort and badges.
- Search/filter verification: Passed for position, tier, label, available-only, trending, notes search, and clear filters.
- Draft/undo verification: Passed with My Team budget, max bid, roster counter update, selected-player state, and undo restoration.
- Autosave verification: Passed by restoring edited tier, label, value, and notes after browser reload.
- Prompt helper verification: Passed bid prompt generation and copy action without API calls.
- Responsive verification: Passed at iPad Pro 12.9 landscape `1366x1024` with no horizontal overflow.
- Xcode build: Intentionally not run; this repository has no Xcode project or native app target.
- iPhone deployment: Not applicable; static web app.
- iPad deployment: Not applicable; static web app. iPad Pro browser viewport verification passed.
- Apple Watch deployment: Not applicable; no Watch target.
