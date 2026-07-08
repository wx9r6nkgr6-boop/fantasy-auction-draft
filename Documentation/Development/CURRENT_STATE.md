# Current State

Last updated by Pass: FAD-2026-07-08-004

## Static Web App

- Status: Open
- Priority: High
- Known Issues: GitHub Pages status must be checked after each push; this pass preserved root static serving.
- Technical Debt: Single-file JavaScript keeps deployment simple but should be modularized if the app grows.
- Next Work: Add automated regression tests around state import/export, ranking stability, roster assignment, and max-bid math.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `static-web-app`, `live-auction-ui`, `github-pages`
- Last Updating Pass: FAD-2026-07-08-004

## Sleeper Import

- Status: Open
- Priority: High
- Known Issues: Depends on Sleeper API availability and browser CORS behavior. Live endpoint verification was blocked in this environment during FAD-2026-07-08-004.
- Technical Debt: No offline bundled full player list; starter sample data is used until import succeeds. Fallback ranks now use deterministic anchors and value curves but are intentionally not official Sleeper rankings.
- Next Work: Add last-good import timestamp display, cached import age warning, optional manual rank import, and a fixture-backed import test.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `sleeper-import`, `fallback-rankings`, `auction-values`
- Last Updating Pass: FAD-2026-07-08-004

## Draft State

- Status: Open
- Priority: High
- Known Issues: Undo only reverses the latest draft pick.
- Technical Debt: Roster assignment uses deterministic starter, flex, IR, then bench allocation and does not support custom roster settings yet. Draft history now stores nominating team and value snapshots, but older exports only have fallback normalized values.
- Next Work: Add configurable roster rules after foundation stabilization.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `draft-state`, `budget-max-bid`, `my-team`, `draft-board`
- Last Updating Pass: FAD-2026-07-08-004

## Player Prep

- Status: Open
- Priority: High
- Known Issues: Notes, labels, and tiers are local/exported state only and do not sync to external services.
- Technical Debt: Prep filter cache keys are simple string snapshots and may need a revision counter for very large edit sessions. Custom auction value changes affect value sorting but do not claim to be market projections.
- Next Work: Add bulk prep import mapping if managers keep rankings in spreadsheets.
- Related Epics: E-FAD-FOUNDATION
- Architecture Tags: `player-prep`, `chatgpt-helper`, `auction-values`
- Last Updating Pass: FAD-2026-07-08-004

## My Team And Auction Guidance

- Status: Open
- Priority: High
- Known Issues: Scarcity warnings are intentionally simple and do not include projection systems, news, or advanced inflation. Auction inflation is shown as a placeholder. My Team summary was removed from the main live screen to prioritize player cards.
- Technical Debt: Max-bid logic assumes $1 minimum bids and required roster slots excluding optional IR.
- Next Work: Add configurable roster settings and optional manual scoring notes for prompt generation.
- Related Epics: E-FAD-LIVE-AUCTION
- Architecture Tags: `my-team`, `budget-max-bid`, `fallback-rankings`, `auction-values`, `draft-board`, `chatgpt-helper`, `draft-assistant`, `context-lock`
- Last Updating Pass: FAD-2026-07-08-004

## Draft Assistant And Context Lock

- Status: Open
- Priority: High
- Known Issues: ChatGPT opens externally and requires the user to paste the copied prompt manually. No API transport is implemented by design.
- Technical Debt: Context Lock is global-browser-script based for GitHub Pages simplicity; future modular builds could expose it as an ES module.
- Next Work: Add prompt templates for post-draft audit and live nomination queue once roster/scoring settings are configurable.
- Related Epics: E-FAD-DRAFT-ASSISTANT
- Architecture Tags: `draft-assistant`, `context-lock`, `chatgpt-helper`, `live-auction-ui`, `auction-values`
- Last Updating Pass: FAD-2026-07-08-004

## Resolved Regression History

- FAD-2026-07-08-001: Established the first functional app surface; no prior app regressions existed in the GitHub repository.
- FAD-2026-07-08-001: Fixed Sleeper trending mismatch by preserving the all-player response map key as the player ID.
- FAD-2026-07-08-001: Replaced starter sample numeric IDs with synthetic IDs to prevent sample prep from attaching to real Sleeper players after refresh.
- FAD-2026-07-08-002: Fixed v2 autosave/import rank instability by reading both Sleeper snake_case fields and exported camelCase fields in the player normalizer.
- FAD-2026-07-08-003: Replaced inline prompt construction with Draft Context Lock and independent prompt engine so all prompts use one locked context snapshot.
- FAD-2026-07-08-004: Fixed random-seeming fallback rankings by switching to deterministic fantasy anchors, stable tie-breaks, and auction-value-primary ordering.
- FAD-2026-07-08-004: Added nominating-team normalization so new and imported draft history preserve nomination context.

## Open Regression History

- FAD-2026-07-08-001: Requested commit `7efdba823b6c33c34476f0224c17a008d4b52ef2` was unavailable locally and remotely, so it could not be pushed.
- FAD-2026-07-08-002: Fallback ranking quality is limited by Sleeper metadata; true projection/ranking feeds are still out of scope.
- FAD-2026-07-08-003: External ChatGPT page may show its own sign-in/browser console warnings; the local app does not control that surface.
- FAD-2026-07-08-004: In-app browser localhost reload was blocked by browser policy in this environment, so browser UI verification for this pass used static server probes and Node VM logic checks rather than a live tab reload.
- FAD-2026-07-08-004: Sleeper live endpoint verification was not completed; sandbox DNS failed and the escalated public endpoint request was rejected by the environment usage-limit gate.

## Verification And Deployment State

- Static syntax checks: `node --check app.js`, `node --check js/contextLock.js`, and `node --check js/chatgpt.js` passed.
- Module verification: Passed Node VM test for deterministic rankings, IDP filtering, team-defense creation, position rank labels, estimated/custom auction values, nominating-team draft history, budget math, and JSON export payload fields.
- Browser testing: Static server started on `http://127.0.0.1:8082/` and returned `HTTP/1.0 200 OK`; in-app browser reload was blocked by browser URL policy.
- Safari compatibility verification: CSS and JavaScript remain static global scripts suitable for GitHub Pages; live Safari verification was not run in this pass.
- JSON export/import verification: Passed Node VM normalization/export checks for new `nominatedByTeamId`, `estimatedValue`, `customValue`, and `auctionValue` fields.
- Sleeper import verification: Normalization/ranking path covered by Node VM with Sleeper-shaped data; live endpoint check not completed due environment network limits.
- Trending import verification: Trending boost path covered by Node VM with synthetic trending data.
- Search/filter verification: Static source audit passed for position, tier, label, value, available-only, and board filters; live UI filter clicks were not run because browser reload was blocked.
- Draft/undo verification: Draft history and budget math passed Node VM checks; live undo click was not run because browser reload was blocked.
- Autosave verification: Export payload and JSON serialization passed; live localStorage reload was not run because browser reload was blocked.
- Prompt helper verification: Passed bid prompt generation and copy action without API calls.
- Draft Assistant verification: Context values now include selected-player estimated/custom auction values for prompt output.
- Responsive verification: CSS updated for iPad Pro 12.9 landscape with larger position-tinted cards, scroll-contained player/roster/board views, and mobile fallback grids. Live visual viewport verification was blocked.
- Xcode build: Intentionally not run; this repository has no Xcode project or native app target.
- iPhone deployment: Not applicable; static web app.
- iPad deployment: Not applicable; static web app. CSS updated for iPad Pro landscape; live viewport verification was blocked in this environment.
- Apple Watch deployment: Not applicable; no Watch target.
