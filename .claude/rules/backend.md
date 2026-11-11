---
paths:
  - "backend/**"
  - "shared/**"
---

# The backend (backend/) and the contract (shared/contracts/)

Node ≥ 22.18 runs the TypeScript directly: no build step, no runtime packages, one process.
Run commands from `backend/`.

## Folders in backend/src

| Folder | Holds |
|---|---|
| `index.ts`, `app.ts`, `config.ts`, `errors.ts`, `log.ts` | start-up, the HTTP server and `API_ROUTES`, settings, errors, logging. No new root files. |
| `http/` | plumbing: context, router, guards, params, rate limits, body, `ok` / `send`, CORS |
| `routes/<area>.ts` | one `RouteGroup` per API area, listed in `API_ROUTES` in `app.ts` |
| `<domain>/` (e.g. `parcels/`, `clinic/`, `health/`, `unit/`) | the domain's rules, called by its route |
| `ems/` | accounts, tokens, the realtime WebSocket, sealing, and the migrations (`ems/db.ts`) |
| `ha/` | the home facade over each unit's Home Assistant |
| `repositories/<table>.ts` | every SQL statement, one file per table |
| `integrations/` | outside systems besides Home Assistant (Docker Engine, AI services, ElevenLabs) |
| `lib/` | small pure helpers |

Tests are HTTP-level, in `backend/test/` (`fakeHa.ts` stands in for Home Assistant).

## Rules

- A request goes route → domain module → repository. Routes stay thin; SQL lives only in
  `repositories/`; a schema change is a new entry at the end of `MIGRATIONS` in `ems/db.ts`
  (never edit an old one).
- Imports: relative ones end in `.ts`; Node built-ins use `node:` (`import { createHash } from 'node:crypto'`).
  No npm packages. Adding a dependency is the user's decision.
- Settings are read once in `config.ts`; document new ones in `backend/.env.example`.
  Nothing else reads `process.env`.
- Keep it one process: no extra servers, workers or queues.
- Check: `npm run typecheck` and `npm test`, or `./scripts/dev.sh check` from the repo root.

## shared/contracts

- One file per area (`shared/contracts/<area>.ts`), re-exported from `index.ts`.
- Types only: `type`, `interface`, `import type`, `export type`. No `const`, functions, classes or enums.
- Both sides import it with `import type` only (CI checks). The backend's Docker image has no
  `shared/` folder, so a value import crashes it.
- Change the contract first, then the backend, then the app.
