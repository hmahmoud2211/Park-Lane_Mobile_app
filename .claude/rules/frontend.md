---
paths:
  - "frontend/**"
---

# The app (frontend/)

Expo SDK 58, React Native, React Navigation. Run every app command from `frontend/`. Before using an
Expo or React Native API, read the SDK 58 docs (`https://docs.expo.dev/versions/v58.0.0/`), not memory.

## Folders in frontend/src

| Folder | Holds | Must not |
|---|---|---|
| `screens/<Name>Screen/` | one folder per route | call `fetch`, import another screen, hold hooks or services |
| `features/<domain>/` | everything one domain needs: `services/`, `hooks/`, `context/`, `components/`, `types.ts` | have other folders or root files |
| `components/<group>/` | UI any screen may use; group is `common`, `ui`, `layout`, `feedback` or `forms` | import `features/` or `screens/`; hold business logic |
| `navigation/` | `AppNavigator.tsx` (routes, web addresses), `sampleScreens.tsx`, `parkingScreens.tsx`, `navTabs` | — |
| `config/` | every setting; `env.ts` is the only reader of `process.env` | — |
| `lib/` | infrastructure: `http/` (`timedFetch`, `timedUpload`), `realtime/` (`ReconnectingSocket`), storage | import features, screens, components or navigation |
| `theme/` | every design token | — |
| `context/`, `hooks/` | app-wide UI state and UI hooks (`useAppTheme`, `useScreenLayout`, `useScreenMenu`, `useFocusQuery`) | domain logic (that is a feature) |
| `types/` | app-wide types; API types build on `shared/contracts` with `import type` | — |
| `utils/` | small pure helpers several domains use | React state, network calls |
| `data/`, `constants/`, `assets/` | shared mock content, the image table, bundled files | — |

No files directly in `src/` and no new top-level folders in `src/`.

## Screens

- A screen folder holds `<Name>Screen.tsx`, `<Name>Screen.styles.ts`, `<Name>Screen.data.ts` and
  `index.ts`. Parts only this screen uses sit beside them as `PascalCase.tsx`; extra data files as
  `<Name>Screen.<part>.ts`. No subfolders.
- `.tsx` composes components and calls hooks. `.styles.ts` exports `createStyles(theme)`.
  `.data.ts` holds the screen's copy (`<name>Copy … as const`), mock content and small formatters.
- Data comes through a feature: `useFocusQuery(someService)` or a feature hook. Never `fetch`.
- Inner screens are built on `InnerScreenFrame` + `PageHeader`. Use `LoadingState`, `ErrorNotice`,
  `Notice`, `NeonPanel`, `SelectableCard` and `useScreenMenu` instead of writing new versions.
- Register a route in two places: `src/types/navigation.types.ts` (`RootStackParamList`) and
  `src/navigation/AppNavigator.tsx` (import, `ROUTE_NAMES`, `<Stack.Screen>`). A screen that shows
  only sample data goes in `navigation/sampleScreens.tsx` so the store build leaves it out.
- `ParamlessRoute` must stay at 25 members or fewer (TypeScript's limit for `navigate(tile.route)`).
  A route no tile or tab opens belongs in `FlowOnlyRoute`.
- Small, complete example to copy: `src/screens/DeliveriesScreen/` with
  `src/features/parcels/services/parcelsApi.ts`.

## Features

- `services/`: API clients and pure logic, no React (`react-native`'s `Platform` is fine). HTTP goes
  through `src/lib/http`; calls to the EMS backend use `call()` from `features/ems/services/emsHttp.ts`.
- `hooks/`: React state over the services. `context/`: providers that start at launch.
  `components/`: UI only this domain uses. `types.ts`: the domain's own types.
- A feature may use another feature's services or hooks (most use `ems`). Code two domains share goes
  to `lib/` (infrastructure), `components/` (UI) or `utils/` (pure helpers).

## Settings

A new `EXPO_PUBLIC_*` variable is read only in `src/config/env.ts`, written out in full
(`process.env.EXPO_PUBLIC_X`) so Expo inlines it, and added to `.env.example` and `eas.json`.
The only exceptions: `EXPO_PUBLIC_HEALTH_API` in `features/health/services`, `EXPO_PUBLIC_STORE_MODE`
in `App.tsx`, `navigation/AppNavigator.tsx` and `ProfileScreen.data.ts`, and `EXPO_PUBLIC_PARKING`
in `navigation/AppNavigator.tsx`.

## Packages and native code

- Add packages with `npx expo install <pkg>` (dev tools: `npx expo install <pkg> -- --save-dev`),
  never `npm install <pkg>` / `yarn add` / `bun add`. Prefer an Expo module when one exists.
- EAS runs `npm ci` with npm 10. After any dependency change, rewrite the lockfile with
  `npx -y npm@10.9.9 install` and check it with `npx -y npm@10.9.9 ci --include=dev --dry-run --ignore-scripts`.
- A package with native code needs a development build, not Expo Go.
- `ios/` and `android/` are generated. Never create or edit them; configure native behaviour in
  `app.json` and config plugins. Fixes to packages go in `patches/` (patch-package).
