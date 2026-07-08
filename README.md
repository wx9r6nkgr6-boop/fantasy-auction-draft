# Fantasy Auction Draft

Static browser app for running a live fantasy football auction draft.

## Current capabilities

- Sleeper import with a cleaned QB/RB/WR/TE plus team-defense draft pool.
- Fallback overall and position ranks from available Sleeper metadata, active status, draft relevance, and trending signals.
- Editable tiers, Target/Sleeper/Avoid labels, custom auction values, and notes.
- My Team designation with pinned budget, max bid, roster needs, and scarcity guidance.
- Team budget and max-bid visibility for every manager.
- JSON export/import and localStorage autosave.
- Local-only Ask ChatGPT prompt helper with no API key or backend.

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
