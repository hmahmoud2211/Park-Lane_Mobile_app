# Project structure: applies to every change

Every change in this repo follows the structure in `docs/PROJECT_STRUCTURE.md` and `AGENTS.md`.
A hook (`.claude/hooks/check-structure.mjs`) checks every Write and Edit and blocks a change that
breaks it. When a request does not fit the structure, say so and ask; do not invent a new layout.

## The repo

| Folder | What it is | Commands run from |
|---|---|---|
| `frontend/` | The Expo app: iOS, Android and web, one codebase | `cd frontend` |
| `backend/` | The EMS device backend: Node ≥ 22.18 running TypeScript directly, no runtime packages | `cd backend` |
| `shared/contracts/` | The API types app and backend share. Types only, nothing runs | — |
| `gateway/` | The CUBE gateway: Python 3.12+, FastAPI, uv | `cd gateway` |

`docker/`, `scripts/`, `tools/` and `docs/` support them. There is no root `package.json`, and no
new top-level folders.

## How a request travels

```
screen → feature hook → feature service → src/lib/http → backend route → domain module → repository (SQL)
   └→ components (common / ui / layout / feedback / forms) → theme tokens
```

An API change starts in `shared/contracts`, then the backend, then the app.

## Where new code goes

| You are adding | Put it in |
|---|---|
| A page / route in the app | `frontend/src/screens/<Name>Screen/` (skill: `add-screen`) |
| A whole feature, app + backend | contract → backend → app (skill: `add-feature`) |
| API calls or pure domain logic | `frontend/src/features/<domain>/services/` (no React) |
| React state over those services | `frontend/src/features/<domain>/hooks/` |
| An app-wide provider for a domain | `frontend/src/features/<domain>/context/` |
| UI only one domain uses | `frontend/src/features/<domain>/components/` |
| UI any screen may use | `frontend/src/components/{common,ui,layout,feedback,forms}/` |
| UI only one screen uses | beside that screen, as `PascalCase.tsx` |
| A setting / `EXPO_PUBLIC_*` variable | `frontend/src/config/` (read only in `config/env.ts`) |
| Colours, type, spacing, radius, shadows | `frontend/src/theme/` |
| App infrastructure (http, realtime, storage) | `frontend/src/lib/` |
| A small pure helper used by several domains | `frontend/src/utils/` |
| An API type | `shared/contracts/<area>.ts`, re-exported from `index.ts`, imported with `import type` |
| A backend endpoint | `backend/src/routes/<area>.ts`, listed in `API_ROUTES` in `backend/src/app.ts` |
| Backend rules for a domain | `backend/src/<domain>/` |
| SQL | `backend/src/repositories/<table>.ts`; schema changes are new migrations in `backend/src/ems/db.ts` |
| A backend setting | `backend/src/config.ts` and `backend/.env.example` |
| A gateway device protocol | `gateway/cube_gateway/adapters/<name>.py` (see `gateway/README.md`) |
| Documentation | `docs/` |

## Exceptions

Old code has a few exceptions the hook knows about (for example the Health Passport web upload's
`fetch` of a local file). The hook only blocks problems a change adds, so editing old code works.
Never copy an exception into new code.

If the user explicitly agrees to a new exception, put a comment with `structure-ok: <reason>` on that
line (for a new file in an unusual place: anywhere in the file). Never add one on your own.

## Before you say a task is done

1. `node .claude/hooks/check-structure.mjs --changed` from the repo root. It also catches changes the
   Edit/Write hook could not see. On a branch, `--changed Master` checks the whole branch.
2. App: `npx tsc --noEmit` and `npx expo lint` from `frontend/`, plus the matching `npm run check:*`
   when you touched that feature (parking, transport, health, pairing, endpoints, account, phones,
   unit, password).
3. Backend: `npm run typecheck` and `npm test` from `backend/`. `./scripts/dev.sh check` runs app and
   backend checks together.
4. Gateway: `uv run ruff check cube_gateway tests` and `uv run pytest -q` from `gateway/`.
5. UI changed: compare screenshots with `frontend/scripts/visual-regression.mjs`
   (`docs/DEVELOPMENT_GUIDE.md`).
6. If you changed the structure itself, update `docs/PROJECT_STRUCTURE.md`, `AGENTS.md`, these rules
   and the hook together, in the same change.

Say plainly which of these you ran and what they printed. If one fails, say so.
