# Fantasy Auction Draft

Static browser app for running a live fantasy football auction draft.

## Current capabilities

- Sleeper import with a cleaned QB/RB/WR/TE plus team-defense draft pool.
- Fallback overall and position ranks from available Sleeper metadata, active status, fantasy anchors, draft relevance, and trending signals.
- Deterministic estimated auction values for a 10-team, $200, 2QB full-PPR draft model.
- Editable tiers, Target/Sleeper/Avoid labels, custom auction values, and notes.
- My Team designation with highlighted manager rows, max-bid math, roster needs, and scarcity guidance.
- Team budget and max-bid visibility for every manager.
- Team Rosters and Draft Board tabs with nominating-team tracking and price-vs-estimate review.
- JSON export/import and localStorage autosave.
- Collapsible Draft Assistant panel backed by a reusable Draft Context Lock.
- Local-only ChatGPT prompt engine with preview, copy, and open-ChatGPT flows. No API key or backend.

## Draft prep notes

Sleeper supplies player metadata, not official fantasy rankings or auction values. The app builds an explainable fallback ranking and estimated auction value from position, active status, fantasy relevance, team/depth metadata, curated anchor ordering, and light trending boosts. Use the estimates as a starting board, not an authoritative projection system.

To adjust a player, select the row and use the prep panel:

- `Tier` overrides the auto-created tier and persists through autosave and JSON export/import.
- `My auction value` overrides the displayed estimate for sorting, draft board snapshots, prompts, autosave, and JSON export/import.
- Target, Sleeper, Avoid, and personal notes are searchable and preserved when Sleeper data is refreshed.

## Run locally

Open `index.html` directly, or serve the folder with any static server:

```sh
python3 -m http.server 8080
```

## GitHub Pages

The app is Pages-ready because all runtime files are static at the repository root:

- `index.html`
- `styles.css`
- `app.js`

If Pages is not already enabled, configure it in GitHub:

1. Open the repository settings.
2. Choose **Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Select branch **main** and folder **/**.
5. Save.

The expected Pages URL is:

https://wx9r6nkgr6-boop.github.io/fantasy-auction-draft/
