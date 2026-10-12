// metro.transformer.js (#280): on the web, a library's own `import()` becomes a lazy `require` that metro.config.js resolves as
// the ESM import it was, so a library that splits itself stays in the one chunk we import it from instead of landing in
// `__common` on the first paint. These run the real transformer (Expo's Babel transformer underneath) and the real resolver
// hook; the export itself is what `bundle-budget.mjs` reads after them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const transformer = require('./metro.transformer.js');
const generate = require('@babel/generator').default;

const SRC = `export const load = () => import('./screen.mjs');\nexport const icon = () => import('@phosphor-icons/webcomponents/PhX');\n`;
const options = (platform) => ({ platform, dev: false, hot: false, minify: false, projectRoot: ROOT, type: 'module', customTransformOptions: {} });
/** The transformer's output as code, for a file at `filename` (relative to the project root, as Metro passes it). */
const out = (filename, platform = 'web', src = SRC) =>
  generate(transformer.transform({ filename, src, options: options(platform), plugins: [] }).ast).code;
const dynamicImports = (code) => (code.match(/\bimport\(/g) ?? []).length;

test('web + node_modules: every string import() becomes a lazy, prefixed require', () => {
  const code = out('node_modules/@privy-io/react-auth/dist/esm/index.mjs');
  assert.equal(dynamicImports(code), 0, code);
  assert.match(code, /Promise\.resolve\(\)\.then\(\(\) => .*require\("gachapon-esm-import:\.\/screen\.mjs"\)/);
  assert.match(code, /require\("gachapon-esm-import:@phosphor-icons\/webcomponents\/PhX"\)/);
});

test('the path Metro really passes is relative: `node_modules/…` at the start of the string counts (a real export matched nothing without it)', () => {
  assert.equal(dynamicImports(out('node_modules/x/index.js')), 0);
  assert.equal(dynamicImports(out(path.join(ROOT, 'node_modules/x/index.js'))), 0);
  assert.equal(dynamicImports(out('packages\\app\\node_modules\\x\\index.js')), 0);
});

test('our own import()s are the split points: src/ keeps them', () => {
  assert.equal(dynamicImports(out('src/auth/loadPrivyWeb.ts')), 2);
  assert.equal(dynamicImports(out('src/node_modules_like/x.ts')), 2); // a name that only contains the word
});

test('native is untouched (one bundle, nothing to split)', () => {
  assert.equal(dynamicImports(out('node_modules/x/index.js', 'ios')), 2);
  assert.equal(dynamicImports(out('node_modules/x/index.js', 'android')), 2);
});

test('a computed specifier is left to Metro', () => {
  const code = out('node_modules/x/index.js', 'web', 'export const f = (n) => import(n);\n');
  assert.equal(dynamicImports(code), 1);
});

test('the lazy require evaluates the module only when the promise runs, and hands back a namespace', async () => {
  const code = out('node_modules/x/index.js', 'web', "globalThis.__loaded = () => import('./m');\n");
  const evaluated = [];
  const fakeRequire = (id) => { evaluated.push(id); return { __esModule: true, default: 'D', named: 'N' }; };
  // The transformed module, run as CommonJS with its helper resolved through the real @babel/runtime.
  const cjs = require('@babel/core').transformSync(code, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  new Function('require', 'module', 'exports', cjs)((id) => (id.startsWith('gachapon-esm-import:') ? fakeRequire(id) : require(id)), { exports: {} }, {});
  assert.deepEqual(evaluated, [], 'nothing is required until the import is called');
  const p = globalThis.__loaded();
  assert.deepEqual(evaluated, [], 'nor synchronously inside the call, as with import()');
  const ns = await p;
  assert.deepEqual(evaluated, ['gachapon-esm-import:./m']);
  assert.equal(ns.default, 'D');
  assert.equal(ns.named, 'N');
  delete globalThis.__loaded;
});

test('a CommonJS module comes back as import() gives it: `default` is its module.exports (what Metro\'s importAll does)', async () => {
  const code = out('node_modules/x/index.js', 'web', "globalThis.__loadCjs = () => import('./cjs');\n");
  const exportsObject = { hello: 'world' }; // no __esModule: a CommonJS module
  const cjs = require('@babel/core').transformSync(code, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  new Function('require', 'module', 'exports', cjs)((id) => (id.startsWith('gachapon-esm-import:') ? exportsObject : require(id)), { exports: {} }, {});
  const ns = await globalThis.__loadCjs();
  assert.equal(ns.default, exportsObject);
  assert.equal(ns.hello, 'world');
  delete globalThis.__loadCjs;
});

test('metro.config.js resolves a prefixed request as the ESM import it was (the import export condition)', () => {
  const config = require('./metro.config.js');
  const seen = [];
  const context = { isESMImport: false, resolveRequest: (ctx, name) => { seen.push({ name, isESMImport: ctx.isESMImport }); return { type: 'empty' }; } };
  // The prefix is stripped and the flag set, then the request goes through the same resolver again (so the isows /
  // zustand / jose rules still apply to it); the base resolver is Expo's, so stand in for it through the context.
  const base = config.resolver.resolveRequest;
  base({ ...context }, `${transformer.ESM_IMPORT_PREFIX}@phosphor-icons/webcomponents/PhX`, 'web');
  const last = seen.at(-1);
  assert.equal(last.name, '@phosphor-icons/webcomponents/PhX');
  assert.equal(last.isESMImport, true);
  base({ ...context }, 'react', 'web');
  assert.deepEqual(seen.at(-1), { name: 'react', isESMImport: false });
});

test('a module with its own `require` binding keeps its import() (the rewrite would bind to the local one, no dependency)', () => {
  const src = "import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);\nexport const f = () => import('y');\n";
  const code = out('node_modules/x/index.mjs', 'web', src);
  assert.equal(dynamicImports(code), 1, code);
  assert.doesNotMatch(code, /gachapon-esm-import/);
});

test("the caller's plugins still run (Metro passes its own, e.g. importLocationsPlugin, through `plugins`)", () => {
  for (const filename of ['node_modules/x/index.js', 'src/x.ts']) {
    let ran = 0;
    const sentinel = () => ({ name: 'sentinel', visitor: { Program() { ran += 1; } } });
    transformer.transform({ filename, src: SRC, options: options('web'), plugins: [sentinel] });
    assert.equal(ran, 1, filename);
  }
});
