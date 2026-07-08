# Architecture Decisions

## ADR-FAD-0001: Repository-Root Static Web App

- Status: Accepted
- Date: 2026-07-08
- Pass ID: FAD-2026-07-08-001
- Tags: `static-web-app`, `github-pages`

### Context

The GitHub repository contained only a README and needed a deployable foundation for a live fantasy auction draft tool.

### Decision

Use repository-root `index.html`, `styles.css`, and `app.js` with no build step. This keeps local browser testing and GitHub Pages deployment simple.

### Consequences

The app can be served directly by GitHub Pages, but JavaScript should be modularized later if feature complexity grows.

## ADR-FAD-0002: Local Draft State With JSON Portability

- Status: Accepted
- Date: 2026-07-08
- Pass ID: FAD-2026-07-08-001
- Tags: `draft-state`, `player-prep`

### Context

Live auction use needs fast local interactions, autosave, and a recoverable export/import format.

### Decision

Persist all draft picks, team names, player prep fields, imported player data, and trending metadata in localStorage and the exported JSON payload.

### Consequences

The app remains fast and offline-friendly after import, but multi-device collaboration is out of scope until a backend is introduced.
