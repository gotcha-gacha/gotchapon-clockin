// Metro, with the three package-exports workarounds Privy's Expo SDK needs (`docs/PRIVY_SETUP.md` §7): `isows` and
// `zustand` resolve to the wrong build under package exports, and `jose` needs the browser condition.
const { getDefaultConfig } = require('expo/metro-config');
const { ESM_IMPORT_PREFIX } = require('./metro.transformer.js');

const config = getDefaultConfig(__dirname);
const base = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // A library's `import()` that metro.transformer.js turned into a `require` (#280): resolve it as the ESM import it was.
  if (moduleName.startsWith(ESM_IMPORT_PREFIX)) {
    return config.resolver.resolveRequest({ ...context, isESMImport: true }, moduleName.slice(ESM_IMPORT_PREFIX.length), platform);
  }
  if (moduleName === 'isows' || moduleName.startsWith('zustand')) {
    const ctx = { ...context, unstable_enablePackageExports: false };
    return (base ?? ctx.resolveRequest)(ctx, moduleName, platform);
  }
  if (moduleName === 'jose') {
    const ctx = { ...context, unstable_conditionNames: ['browser'] };
    return (base ?? ctx.resolveRequest)(ctx, moduleName, platform);
  }
  return (base ?? context.resolveRequest)(context, moduleName, platform);
};

// On the web, a library's own `import()`s become lazy `require`s, so a library that splits itself (Privy's SDK) stays in
// the one chunk we import it from instead of landing in `__common` on the first paint (#280; the file says why).
config.transformer.babelTransformerPath = require.resolve('./metro.transformer.js');

module.exports = config;
