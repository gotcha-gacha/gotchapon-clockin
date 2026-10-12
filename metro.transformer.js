// Expo's Babel transformer, with one addition on the web: an `import()` inside `node_modules` becomes a lazy `require` (#280).
//
// Why: Metro's web export moves every module that two async chunks share into `__common`, and the page's HTML loads
// `__common` WITH the entry chunk (`@expo/metro-config` serializer, `extractCommonChunk`). Privy's web SDK splits itself
// with its own `import()`s, about 120 screen and icon chunks, and all of them share the SDK's core with `privyWebChunk`.
// So the core — 2,546,256 bytes gzipped — landed in `__common`, on every visitor's first paint, including with Privy off.
// (CLAUDE.md, "two `import()`s that share code put it in the first paint".)
//
// With the library's own `import()`s turned into `require`s, Metro sees ordinary dependencies: the whole SDK is ONE async
// chunk behind our `import('./privyWebChunk')`, nothing is shared between async chunks, and nothing reaches `__common`.
// What does not change: WHEN library code runs. `Promise.resolve().then(() => require(x))` still evaluates `x` on the tick
// after the call, as `import()` did, and `interopRequireWildcard` hands back the same namespace shape as Metro's own
// `asyncRequire` (`require.importAll`). What does: the bytes of a library's lazy parts download with that library's chunk
// instead of on demand (about 650 KB gzipped of Privy screens, fetched only when Privy is configured).
// And one more: Metro treats `import('pkg').catch(h)` as an OPTIONAL dependency (a missing package builds, and rejects at
// runtime); the rewritten `require` inside a helper call is not in that shape, so a missing optional package now fails the
// web export instead (PR #288's review, measured with Metro's collectDependencies). Loud, at build time; nothing in today's
// graph hits it. An `import()` inside try/await stays optional.
//
// Only the web (a native bundle is one file; there is nothing to split), and only `node_modules`: our own `import()`s in
// `src/` (Skia, the shell's chrome, PostHog, Privy's wrapper) are the split points and stay async. Jest does not use this
// file (its projects have their own Babel transforms). `pnpm verify:web`'s bundle budget is what proves it worked: the SDK
// body's marker must be outside what the page loads first, and the first paint under its own ceiling.
const upstream = require('@expo/metro-config/babel-transformer');

// Metro hands the transformer a path RELATIVE to the project root (`node_modules/@privy-io/…`), so the start of the string
// counts as a boundary — a pattern that wants a separator in front matched nothing in a real export (measured), while a
// test that passed an absolute path went green. The same spelling as Expo's own transform worker.
const NODE_MODULES = /(?:^|[\\/])node_modules[\\/]/;

/** What a rewritten `require` asks for: `metro.config.js`'s resolver strips it and resolves the rest as the `import()` it was.
 *  Without it the `require` resolves under the package's `require` export condition, not `import` — and a package that
 *  exports only `import` (`@phosphor-icons/webcomponents`, which @reown/appkit loads its icons from) fails the whole export
 *  with "Unable to resolve module" (measured). Metro picks the condition from `context.isESMImport` alone
 *  (metro-resolver `matchSubpathFromExportsLike`). */
const ESM_IMPORT_PREFIX = 'gachapon-esm-import:';

/** `import(x)` → `Promise.resolve().then(() => interopRequireWildcard(require('<prefix>' + x)))`. */
function lazyRequireForDynamicImport({ types: t }) {
  return {
    name: 'gachapon-lazy-require-for-dynamic-import',
    visitor: {
      CallExpression(path) {
        if (path.node.callee.type !== 'Import') return;
        const [source] = path.node.arguments;
        // A computed specifier cannot become a static dependency either way; leave it to Metro.
        if (!source || !t.isStringLiteral(source)) return;
        // A module with its own `require` binding (`const require = createRequire(import.meta.url)`) would get the call bound to
        // THAT, which Metro does not collect as a dependency: no chunk, a rejection at runtime, and a green export (PR #288's
        // review, measured). Leave such an `import()` to Metro.
        if (path.scope.hasBinding('require')) return;
        const wildcard = this.addHelper('interopRequireWildcard');
        const loaded = t.callExpression(wildcard, [t.callExpression(t.identifier('require'), [t.stringLiteral(ESM_IMPORT_PREFIX + source.value)])]);
        path.replaceWith(
          t.callExpression(
            t.memberExpression(t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('resolve')), []), t.identifier('then')),
            [t.arrowFunctionExpression([], loaded)],
          ),
        );
      },
    },
  };
}

function transform(args) {
  if (args.options.platform === 'web' && NODE_MODULES.test(args.filename)) {
    return upstream.transform({ ...args, plugins: [...(args.plugins ?? []), lazyRequireForDynamicImport] });
  }
  return upstream.transform(args);
}

// No cache key of our own: Expo's transform worker already hashes the `babelTransformerPath` file's bytes into its key
// (`@expo/metro-config` metro-transform-worker, `getCacheKey`), so an edit here invalidates every cached transform.
const { getCacheKey } = upstream;

module.exports = { transform, getCacheKey, lazyRequireForDynamicImport, ESM_IMPORT_PREFIX };
