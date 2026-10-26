// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // IOT/ is the Home Assistant platform, a separate Python project.
    ignores: ["dist/*", "IOT/*"],
  }
]);
