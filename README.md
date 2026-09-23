# Parklane

A cross-platform (iOS, Android, Web) mobile app for Parklane residents, built with
[Expo](https://expo.dev) and React Native. The UI follows a dark, "glass" design
language — frosted, blurred panels with a blue-to-pink gradient hairline — driven
entirely by tokens defined in [`src/theme/`](src/theme/).

## Tech stack

| Layer          | Choice                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| Framework      | [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) (managed workflow) |
| UI runtime     | React 19 / React Native 0.86                                          |
| Language       | TypeScript                                                             |
| Navigation     | [React Navigation](https://reactnavigation.org/docs/native-stack-navigator) — native-stack (not Expo Router) |
| Styling        | Hand-written `StyleSheet`s driven by design tokens in `src/theme/`    |
| Fonts          | Inter (via `@expo-google-fonts/inter`, subpath-imported per weight)   |
| Effects        | `expo-blur` (frosted glass), `expo-linear-gradient` (gradient fills/strokes) |
| Icons          | `@expo/vector-icons`, plus a few hand-rolled SVG icons                |
| QR codes       | `react-native-qrcode-svg`                                             |
| Web build/host | Expo web (Metro bundler) deployed to Vercel                           |
| Lint           | ESLint (`eslint-config-expo`)                                         |

## Prerequisites

- Node.js `22.x` (pinned in `package.json#engines`)
- npm (repo ships a `package-lock.json`; use `npx`, not `bunx`, since there is no `bun.lock`)
- [Expo CLI](https://docs.expo.dev/more/expo-cli/) — no global install needed, invoked via `npx expo`
- For native builds/testing: Xcode (iOS) and/or Android Studio (Android), or just the
  [Expo Go](https://expo.dev/go) app on a physical device for quick preview
- An [EAS](https://docs.expo.dev/eas/) account if you plan to run cloud builds or OTA updates

## Getting started

```bash
# 1. Install dependencies (use expo install, not npm install, for any new packages)
npm install

# 2. Start the dev server
npx expo start
```

From the Metro dev server output you can:

- Press `i` to open in the iOS Simulator
- Press `a` to open in the Android Emulator
- Press `w` to open in a web browser
- Scan the QR code with the Expo Go app on a physical device

> **Note:** This app uses `expo-blur`, `expo-linear-gradient`, `expo-font`, and other
> native modules. If a module isn't included in Expo Go, run a development build
> instead: `npx expo run:ios` / `npx expo run:ios` locally, or
> `eas build --profile development` in the cloud.

## Available scripts

Defined in [`package.json`](package.json):

| Script          | Command                              | Purpose                                      |
| --------------- | ------------------------------------- | --------------------------------------------- |
| `npm start`     | `expo start`                          | Start the Metro dev server                    |
| `npm run android` | `expo start --android`              | Start dev server and open Android             |
| `npm run ios`   | `expo start --ios`                    | Start dev server and open iOS Simulator       |
| `npm run web`   | `expo start --web`                    | Start dev server for web                      |
| `npm run lint`  | `expo lint`                           | Run ESLint                                    |
| `npm run build` | `expo export --platform web`          | Produce a static web build in `dist/`         |
| `npm run serve` | `npx serve dist --single`             | Serve the exported web build locally (SPA mode) |

Additional commands used during development (not in `package.json`, run directly):

```bash
npx expo install <package>   # Add a dependency — resolves SDK-57-compatible versions
npx tsc --noEmit             # Type-check the project
npx expo-doctor              # Diagnose dependency/config issues
npx expo install --fix       # Fix incompatible package versions
```

**Before declaring any task done, run lint and typecheck:**

```bash
npx expo lint && npx tsc --noEmit
```

## Project structure

```
Park-Lane_Mobile_app/
├── App.tsx                      # Root component: font loading, providers, status bar, nav mount
├── app.json                     # Expo app config (name, icons, splash, plugins)
├── vercel.json                  # Vercel deployment config for the web export
├── index.ts                     # Expo entry point (registers App.tsx as root)
├── assets/                      # App icons, splash images, Figma screen exports (design reference)
│   └── Screens/                 # Figma exports used to verify pixel-accurate styling
└── src/
    ├── assets/images/           # In-app images (backgrounds, icons, illustrations, logos)
    ├── components/
    │   ├── common/               # Reusable primitives: AppButton, AppInput, AppText,
    │   │                         #   BackButton, GradientText, AppBackground, GlassSurface
    │   ├── layout/                # Structural components: ScreenWrapper, ScreenHeader,
    │   │                          #   BottomBar, WebViewport (constrains web layout to a
    │   │                          #   mobile-sized viewport)
    │   └── ui/                    # Feature-specific pieces: AppMenu, Avatar, PromoCard,
    │                              #   ServiceTile, UnitSummaryCard, WeatherPill, icons, etc.
    ├── constants/                 # appConfig.ts, images.ts (static config & image maps)
    ├── context/
    │   ├── AppContext.tsx         # App-wide state (e.g. onboarding completion)
    │   └── ThemeContext.tsx       # Resolves the active theme (see src/theme/)
    ├── hooks/                     # useAppContext, useAppTheme, useResponsive
    ├── navigation/
    │   └── AppNavigator.tsx       # Native-stack navigator; registers all screens
    ├── screens/
    │   ├── FirstScreen/           # Onboarding / splash screen
    │   ├── LoginScreen/           # Auth screen
    │   ├── HomeScreen/            # Post-login dashboard
    │   └── ProfileScreen/         # User profile
    ├── theme/                     # Design tokens — the single source of truth for styling
    │   ├── colors.ts              # Palette + semantic color roles
    │   ├── typography.ts          # Font families, sizes, weights
    │   ├── spacing.ts             # Spacing scale
    │   ├── borderRadius.ts        # Corner radius scale
    │   ├── shadows.ts             # Shadow/elevation presets
    │   ├── glass.ts                # "Glass" frame spec (blur intensity, gradient, stroke)
    │   └── index.ts                # Barrel export + parklaneTheme object
    ├── types/                     # navigation.types.ts, theme.types.ts
    └── utils/                     # responsive.ts, webFormStyles.ts
```

### Screen module convention

Each screen lives in its own folder under `src/screens/<Name>/` with four files:

```
src/screens/<Name>/
├── <Name>.tsx        # Component
├── <Name>.styles.ts  # StyleSheet, measured against the Figma export in assets/Screens/
├── <Name>.data.ts     # Static copy/data used by the screen
└── index.ts           # Re-export
```

When adding a new screen:

1. Create the folder following the convention above.
2. Register it in [`src/navigation/AppNavigator.tsx`](src/navigation/AppNavigator.tsx) (add a
   `<Stack.Screen>`).
3. Add its route name and params to
   [`src/types/navigation.types.ts`](src/types/navigation.types.ts) (`RootStackParamList`).
4. Style values in `.styles.ts` should match the corresponding Figma export in
   `assets/Screens/` — treat them as real measurements, not eyeballed numbers.

## Design system

All color, typography, spacing, radius, shadow, and glass tokens live in
[`src/theme/`](src/theme/). **No raw hex value or font size should appear outside that
folder** — components consume tokens via `useAppTheme()`.

- **Palette & semantics** — `src/theme/colors.ts` defines the raw palette (electric
  cyan, neon blue, violet, magenta, deep navy) plus semantic roles (`primary`,
  `background`, `textPrimary`, etc.) and screen-specific derived tokens (card stroke
  gradients, scrims, glow colors). Comments in that file trace each value back to its
  source (palette sheet vs. Figma screenshot).
- **The "Glass" frame** — [`src/components/common/GlassSurface.tsx`](src/components/common/GlassSurface.tsx)
  implements the signature look: a `BlurView` backdrop, a translucent 20%
  `#4F7BFF → #FF5CCB` gradient fill, and either a white hairline stroke or a
  glowing gradient ring (drawn as an SVG overlay so the color doesn't bleed through
  the translucent body). Build new cards, fields, and buttons on top of
  `GlassSurface` rather than re-implementing blur/gradient/stroke by hand.
- **Theming** — `ThemeContext` resolves the active theme by name; today only
  `parklaneTheme` (dark) exists, but the indirection lets a second palette be added
  without touching any component. Access it via `useAppTheme()`.
- **Responsive/web layout** — `WebViewport` (in `src/components/layout/`) constrains
  the app to a phone-sized viewport when running in a browser, and `useResponsive`/
  `src/utils/responsive.ts` provide scaling helpers.

## Navigation

This project uses **React Navigation** with a native-stack navigator — **not Expo
Router**. All routes are:

- Registered in [`src/navigation/AppNavigator.tsx`](src/navigation/AppNavigator.tsx)
- Typed in [`src/types/navigation.types.ts`](src/types/navigation.types.ts)

Current routes (`RootStackParamList`): `FirstScreen` (initial), `Login`, `Home`,
`Profile`. Headers are disabled app-wide (`headerShown: false`); each screen renders
its own header via `ScreenHeader` where needed.

Docs: https://reactnavigation.org/docs/native-stack-navigator

## Building & deployment

### Native builds (EAS)

Builds, signing, and store submission are handled by [EAS](https://docs.expo.dev/eas/index.md) —
no local Xcode/Android Studio project is checked in (`ios/`/`android/` don't exist;
they're generated via Continuous Native Generation from `app.json` when needed).

```bash
npx eas-cli@latest build --platform ios
npx eas-cli@latest build --platform android
npx eas-cli@latest submit --platform ios
npx eas-cli@latest update   # ship an over-the-air JS update
```

> Never hand-edit `ios/` or `android/` if they get generated locally — configure
> native behavior through `app.json` and config plugins instead.

### Web build (Vercel)

The web export is a static Metro/Expo web bundle, deployed to Vercel per
[`vercel.json`](vercel.json):

```bash
npm run build   # expo export --platform web  → outputs to dist/
npm run serve   # preview the export locally via `serve`
```

`vercel.json` rewrites all non-asset routes to `index.html` (SPA fallback) and sets
long-lived immutable caching for `_expo/static/` and `assets/`, with no-cache on
`index.html` so new deploys are always picked up.

## Working with Expo APIs

This project pins `expo` to `~57.0.24`. Expo's APIs change significantly between SDK
versions, so **before writing code against any Expo/EAS/React Native API**:

1. Confirm the major SDK version in [`package.json`](package.json) (currently 57).
2. Check the versioned docs: https://docs.expo.dev/versions/v57.0.0/
3. For anything else, check https://docs.expo.dev/llms.txt for the current API surface
   and known LLM misconceptions before relying on memory.

Prefer Expo's own modules (e.g. `expo-blur`, `expo-linear-gradient`, `expo-font`) over
third-party equivalents, and always install packages with `npx expo install <package>`
rather than `npm install` so versions stay SDK-compatible.

## Contributing / workflow notes

- Run `npx expo lint` and `npx tsc --noEmit` before considering any change complete.
- Keep style values sourced from the Figma exports in `assets/Screens/` rather than
  eyeballed — screens are measured against those references.
- Don't introduce raw color/font-size literals outside `src/theme/`.
- If `ios/`/`android/` directories appear locally (from Continuous Native
  Generation), don't commit hand edits to them — they're regenerated from
  `app.json` and config plugins.
