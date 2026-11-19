/**
 * app.json, plus the one value that must not be committed: the Google Maps key Family Circle's map needs on Android
 * (expo-maps). EAS builds read it from the EAS environment variable GOOGLE_MAPS_ANDROID_API_KEY (set it once with
 * `npx eas-cli@latest env:create`, see docs/plans/FAMILY_CIRCLE_PLAN.md); local builds from .env.local. Without
 * it the app still builds and runs, and the Android map stays blank.
 *
 * Everything else stays in app.json.
 */
module.exports = ({ config }) => {
  const apiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  if (!apiKey) {
    return config;
  }
  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...config.android?.config,
        googleMaps: { apiKey },
      },
    },
  };
};
