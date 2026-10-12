// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // `.claude/worktrees/` holds the desktop app's per-session worktrees, nested inside the repo: from the root, `eslint .`
    // would lint every other session's checkout (~15,000 errors). Flat-config ignores match paths relative to THIS file's
    // directory (as `eslint .` finds it; `-c <file>` would make it the cwd), so the pattern is anchored by construction: a checkout that is itself one of those worktrees sees its own
    // files as `src/…`, never as `.claude/worktrees/…`, and still lints them. Guarded by src/test/eslintIgnores.test.ts.
    ignores: [".claude/worktrees/", ".expo/**", "dist/*", "design/*", "prototypes/*", "data/*", "ios/*", "android/*", "server/*", "onchain/*", "wrangler.web.jsonc"],
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { Buffer: "readonly" } },
  }
]);
