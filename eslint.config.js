// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "web-build/*", "supabase/functions/*"],
  },
  {
    // Build scripts run under Node, the service worker under the browser's worker scope.
    files: ["scripts/**/*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["public/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
]);
