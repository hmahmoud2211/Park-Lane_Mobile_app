# Build validation

Date: 10 November 2026 · Mac: macOS 27.0.1 (Apple Silicon), Xcode 27.2 (27B52), CocoaPods 1.17.0, Node 24.13.0 ·
No Android SDK on this Mac · EAS CLI 27.7.2, logged in with access to `hazemmahm03` (not to the team project
`emscompany2016s-team`).

## iOS

All three builds are unsigned **Release builds for the iOS Simulator**, made from a scratch copy of `frontend/`:

```bash
npx expo prebuild -p ios --clean --no-install
cd ios && pod install
xcodebuild -workspace Parklane.xcworkspace -scheme Parklane -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The `production` profile's variables were set (`EXPO_PUBLIC_DEVICE_BACKEND_URL`, `EXPO_PUBLIC_ASSISTANT_URL`;
run 3 also `EXPO_PUBLIC_STORE_MODE=1`, `EXPO_PUBLIC_DEMO_TOOLS=0`).

| Run | Code | Build | Launch on iPhone 17 simulator (iOS 26.5) |
|---|---|---|---|
| 1 | Master's packages | BUILD SUCCEEDED (~7 min) | **Crashed at launch.** `dyld: Symbol not found: … ExpoModulesCore … AnyModule._classTypes`, referenced from `ExpoImageManipulator.framework`. The prebuilt Expo binaries came from mismatched package versions (`expo` 58.0.19 against newer modules) |
| 2 | after `npx expo install --fix` | BUILD SUCCEEDED | Launched, stayed running, welcome screen drawn |
| 3 | final code, store mode | BUILD SUCCEEDED | Launched, stayed running, welcome screen drawn; no crash report |

Facts read from the run-3 app bundle:

- **SDK:** iOS 27.2. **Minimum iOS:** 16.4. **Version:** 1.0.0 (build 1 locally; EAS sets the real build number remotely).
- **Info.plist:**
  - camera, microphone, photo library, location-when-in-use and local-network texts present and accurate;
  - **no** `NSFaceIDUsageDescription`;
  - `UIBackgroundModes: audio`;
  - ATS allows only local networking.
- **Entitlements:** `com.apple.developer.networking.HotspotConfiguration`, `com.apple.developer.networking.wifi-info`.
- **PrivacyInfo.xcprivacy:** UserDefaults CA92.1; FileTimestamp C617.1, 3B52.1; SystemBootTime 35F9.1; DiskSpace E174.1; tracking false. Library bundles carry their own manifests too.
- **JS bundle (Hermes):** 4.8 MB, down from 5.4 MB. No demo names, receipts, demo links or the parking test runner.

**Not done here, and why:**

- No App Store archive (`.ipa`), signing or upload. That needs the team's Apple Developer account, a distribution certificate and a provisioning profile.
- Not run on a real iPhone or iPad.

**What to run (team Expo account, Apple credentials on EAS):**

```bash
cd frontend && npx eas-cli@latest build -p ios --profile production
```

Then check the build page for the Xcode version (it must be 26 or later) and install it through TestFlight.

## Android

There is no Android SDK on this Mac, so Android was built on **EAS**:

- **Profile:** `production`, from a scratch copy of today's code.
- **Project:** your personal Expo project `@hazemmahm03/parklane`, because the CLI can't access the team project. Only `owner` and `projectId` were changed in the copy; the repository still points at the team project.
- **Signing:** the personal project's keystore, so this `.aab` is for validation only and is **not** the file to upload.

```bash
EAS_NO_VCS=1 npx eas-cli@latest build -p android --profile production --non-interactive --no-wait
```

| Item | Result |
|---|---|
| EAS build | `f4bc8a96-6604-4c53-abe2-a8e430d42523`, started 18:01 UTC, still **IN_QUEUE** on the free tier at 18:14 UTC |
| Upload | 36.8 MB (no `node_modules`); version code 2 on the personal project; distribution STORE |
| Gradle / AAB result | **NOT VERIFIED yet** (pending the queued build) |
| Target SDK in the built manifest | **NOT VERIFIED yet**. React Native 0.88's default is 36 |
| 16 KB page alignment of the `.so` files | **NOT VERIFIED yet**. A checker that reads each library's ELF headers is ready |

**What to run for the real release (team account):**

```bash
cd frontend && npx eas-cli@latest build -p android --profile production
```

The team project's upload key and Play App Signing are then used.

## Build reproducibility

- `package-lock.json` was regenerated with npm 10.9.9 (EAS runs `npm ci` with npm 10): `npx -y npm@10.9.9 ci --include=dev --dry-run --ignore-scripts` passes.
- All Expo packages match SDK 58's expected versions. Expo Doctor: the version check passes; one informational note remains (`react-native-tcp-socket` untested on the New Architecture).
- `react-native-wifi-reborn` keeps its Gradle 9 patch (`patches/`, applied by `postinstall`).
- EAS dashboard variables for the `production` environment could not be seen from this Mac. If any are set there, they also go into store builds.
