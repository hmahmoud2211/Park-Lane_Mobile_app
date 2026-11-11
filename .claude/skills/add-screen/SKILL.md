---
name: add-screen
description: Add a new screen (page, route) to the Park-Lane Expo app the way this project builds them - a screen folder with .tsx, .styles.ts, .data.ts and index.ts, the route registered in AppNavigator and navigation.types, data through a feature service or hook, built on InnerScreenFrame and theme tokens. Use whenever the user asks for a new page, screen, view or route in frontend/, even if they only describe what it should show.
---

# Add a screen

Work from `frontend/`. The model to copy is `src/screens/DeliveriesScreen/` (with
`src/features/parcels/services/parcelsApi.ts`): small, complete and current.

## 1. Decide before writing

- **Name**: `<Name>Screen`, PascalCase (for example `LostItemsScreen`). The route name is `<Name>`.
- **Design**: look in `assets/Screens/` for its Figma export. If there is one, measure from it. If not,
  take the nearest inner screen's measurements and say so in a comment at the top of `.styles.ts`.
- **Data**:
  - From the backend → it needs a feature service in `src/features/<domain>/services/`. If the
    endpoint does not exist yet, use the `add-feature` skill instead (contract → backend → app).
  - Sample data only → keep it in `.data.ts` and register the screen in `navigation/sampleScreens.tsx`.
- **Way in**: which tile, menu item or button opens it. Ask the user if it is not clear.

## 2. Create the folder

`src/screens/<Name>Screen/`:

| File | Contents |
|---|---|
| `<Name>Screen.tsx` | `export function <Name>Screen()`. `useAppTheme()` + `useMemo(() => createStyles(theme), [theme])`. `InnerScreenFrame` + `PageHeader`. Loading, error and empty states with `LoadingState`, `ErrorNotice`, `Notice`. Panels with `NeonPanel` / `GlassSurface`. Text with `AppText variant=...`. Data with `useFocusQuery(service)` or a feature hook. |
| `<Name>Screen.styles.ts` | `export function createStyles(theme: AppTheme)` returning `StyleSheet.create(...)`. Measurements as named constants at the top; the rhythm from `layout.innerScreen`; colours and type from `theme`. No hex, no `fontSize: <number>`. |
| `<Name>Screen.data.ts` | `export const <name>Copy = { title, subtitle, ... } as const`, mock content, small pure formatters. |
| `index.ts` | `export { <Name>Screen } from './<Name>Screen';` |

Parts only this screen uses go beside it as `PascalCase.tsx`. Parts another screen also needs go in
`src/components/<group>/` (no domain logic) or `src/features/<domain>/components/`.
A screen never calls `fetch` and never imports another screen's files.

## 3. Register the route

1. `src/types/navigation.types.ts`: add `<Name>: undefined;` (or its params) to `RootStackParamList`,
   with a one-line comment. If it takes no params and no tile or tab opens it, add it to
   `FlowOnlyRoute`: `ParamlessRoute` must stay at 25 members or fewer.
2. `src/navigation/AppNavigator.tsx`: import the screen, add the name to `ROUTE_NAMES`, add
   `<Stack.Screen name="<Name>" component={<Name>Screen} />` next to its neighbours. Sample-data
   screens go in `navigation/sampleScreens.tsx` instead.
3. Add the way in (the tile, menu item or button) where the user expects it.

## 4. Wider screens

The phone layout (< 768dp) stays as drawn. For tablets and web, reflow with `useScreenLayout()`,
`ResponsiveColumns` or `ResponsiveGrid`; never size from the window.

## 5. Check

From the repo root: `node .claude/hooks/check-structure.mjs --changed`.
From `frontend/`: `npx tsc --noEmit` and `npx expo lint`.
Then compare screenshots with `scripts/visual-regression.mjs` (see `docs/DEVELOPMENT_GUIDE.md`).
Report what you ran and what it printed.
