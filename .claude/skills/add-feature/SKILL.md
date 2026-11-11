---
name: add-feature
description: Add a feature that spans the Park-Lane stack - API types in shared/contracts, the backend (migration, repository, domain module, route, tests) and the app (feature service, hook, screen) - in this project's structure and order. Use when the user asks for something new residents or staff can do that needs data from the server, a new API endpoint, or a new table, even if they only describe the outcome.
---

# Add a feature, end to end

Order matters: **contract → backend → app → checks**. The model to copy is parcels:
`shared/contracts/parcels.ts` → `backend/src/repositories/parcels.ts` → `backend/src/parcels/parcels.ts`
→ `backend/src/routes/visitors.ts` (the `/api/parcels` part) → `backend/test/unit-visitors-parcels.test.ts`
→ `frontend/src/features/parcels/services/parcelsApi.ts` → `frontend/src/screens/DeliveriesScreen/`.

Running example below: residents report a lost item (`lostItems`).

## 0. Agree the shape

Write down, and confirm with the user if anything is unclear: who uses it (resident, staff, admin),
the endpoints (`GET /api/lost-items`, `POST /api/lost-items`), the fields, and whether changes are
pushed live (realtime event) or only loaded on focus.

## 1. Contract: shared/contracts

- New file `shared/contracts/lostItems.ts` with `interface LostItem { ... }` and request/response
  types. Re-export it from `shared/contracts/index.ts`.
- Types only: no `const`, functions, classes or enums.

## 2. Backend: backend/src

1. **Migration**: append a new entry at the end of `MIGRATIONS` in `ems/db.ts` with
   `CREATE TABLE lost_items (...)` and its indexes. Never edit an earlier migration.
2. **Repository**: `repositories/lostItems.ts` with a `LostItemRow` interface and one function per
   statement (`insertLostItem`, `listUnitLostItems`, ...), using `db().prepare(...)`. All SQL lives here.
3. **Domain module**: `lostItems/lostItems.ts`: the rules (who may see what, validation with
   `ApiError`, `present(row)` turning a row into the contract type, notifications or `publishToUnit`
   for live updates). Imports end in `.ts`; the contract with `import type`.
4. **Route**: `routes/lostItems.ts` exporting `lostItemRoutes: RouteGroup`, thin: match `path` and
   `method`, `requireUser(req)` / a guard, `await readJson(req)` for bodies, `ok(res, data)`. List
   the paths in the file's top comment. Add it to `API_ROUTES` in `app.ts` (admin routes before
   `opsRoutes`). If the area already has a route module (as parcels sit in `visitors.ts`), extend it instead.
5. **Tests**: `test/lostItems.test.ts`, HTTP-level like the other tests: success, wrong user, bad input.
6. Settings, if any: `config.ts` and `backend/.env.example`. No npm packages.
7. `docs/API_DOCUMENTATION.md`: add the endpoints.

## 3. App: frontend/src

1. **Service**: `features/lostItems/services/lostItemsApi.ts`:
   `export const listLostItems = () => call<LostItem[]>('/api/lost-items', { retry: true });` with
   `call` from `../../ems/services/emsHttp` and the type through `import type`. No React here.
2. **Hook** (when the screen needs more than a single load): `features/lostItems/hooks/useLostItems.ts`.
   For a plain load, the screen uses `useFocusQuery(listLostItems)`.
3. **Types** only the app needs: `features/lostItems/types.ts`.
4. **Screen**: follow the `add-screen` skill (folder, route registration, way in).
5. **Live updates**: listen with `useEms().onRealtimeEvent` as `DeliveriesScreen` does; add the event
   type to `shared/contracts/events.ts`.

## 4. Documentation

Add the feature to "Where each feature lives" in `docs/PROJECT_STRUCTURE.md`. A larger feature gets
its own `docs/<NAME>.md`.

## 5. Check

- Repo root: `node .claude/hooks/check-structure.mjs --changed`, then `./scripts/dev.sh check`
  (app typecheck + lint, backend typecheck + tests).
- Screenshots of the new screen with `frontend/scripts/visual-regression.mjs`.

Report each command and its result. If something could not be tested (no device, no server), say so.
