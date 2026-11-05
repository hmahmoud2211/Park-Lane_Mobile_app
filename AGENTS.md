This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Repository layout

- `frontend/` is the Expo app (`app.json`, `eas.json`, `package.json`, `src/`). Run every app
  command below from there; the paths in the rest of this file are relative to it.
- `backend/` is the EMS device backend (Node, no runtime packages), `gateway/` the CUBE
  gateway (Python). They have their own tooling and READMEs.
- `scripts/dev.sh` runs the pieces together; see docs/DEVELOPMENT_GUIDE.md.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `frontend/package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
cd frontend
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- This project uses **React Navigation** (native-stack), not Expo Router.
  Routes are registered in `src/navigation/AppNavigator.tsx` and typed in
  `src/types/navigation.types.ts`. Add a screen in both places.
- Screens live in `src/screens/<Name>/` as `<Name>.tsx`, `.styles.ts`, `.data.ts`
  and `index.ts`. A screen never imports another screen's files and never calls
  `fetch`; it uses components and feature hooks.
- Docs: https://reactnavigation.org/docs/native-stack-navigator

## Where code goes

See docs/PROJECT_STRUCTURE.md. In short:

- Domain code goes in `src/features/<domain>/` (`services/` without React, `hooks/`,
  `context/`, `components/`, `types.ts`). Services reach other systems only through
  `src/lib/http` (`timedFetch`) and `src/lib/realtime` (`ReconnectingSocket`).
- UI any screen may use goes in `src/components/` (`common`, `ui`, `layout`, `feedback`,
  `forms`). Inner screens are built on `InnerScreenFrame`; use `LoadingState`, `ErrorNotice`,
  `SelectableCard` and `useScreenMenu` rather than re-implementing them.
- Settings go in `src/config/`. A new `EXPO_PUBLIC_*` variable is read only in
  `src/config/env.ts`, written out in full (`process.env.EXPO_PUBLIC_X`) so Expo inlines it.
  The one exception is `EXPO_PUBLIC_HEALTH_API` at the mock's `require()` calls: reading it
  through `env.ts` there ships sample medical records (docs/HEALTH_PASSPORT.md).
- API types the backend shares live in `../shared/contracts`, imported with `import type`
  only (CI checks it); `src/types/home.types.ts` and `ems.types.ts` build on them.
- Backend: routes in `backend/src/routes`, SQL in `backend/src/repositories`; keep it one
  process. Run `./scripts/dev.sh check` before declaring a change done.
- Changing UI? Compare with `frontend/scripts/visual-regression.mjs` (docs/DEVELOPMENT_GUIDE.md).

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Design system

- All colour, type, spacing, radius, shadow and glass tokens live in `src/theme/`.
  Never write a raw hex value or font size outside that folder.
- The signature "Glass" frame (blur + 20% #4F7BFF->#FF5CCB gradient + white
  hairline) is `src/components/common/GlassSurface.tsx`. Build new cards, fields and
  buttons on it rather than re-implementing the effect.
- Screens are measured against their Figma export in `assets/Screens/`. Values in
  a screen's `.styles.ts` are real measurements, so change them against the
  reference, not by eye. The inner screens' shared rhythm (16dp gutter, 35dp header
  gutter, 30 / 18 / 14 spacing, 46dp buttons) is `layout.innerScreen` in `src/theme/layout.ts`.
- Responsive: the Figma layouts are the phone (< 768dp) layouts and must stay as
  drawn. Wider device classes reflow through `useScreenLayout()`,
  `ResponsiveColumns` and `ResponsiveGrid` (see README, "Responsive layout"), with
  breakpoints, widths and gutters from `src/theme/breakpoints.ts` and
  `src/theme/layout.ts`. Size from `useScreenLayout()`, never from the window.
