// The first screen's sky shader (#211), compiled by Skia's own SkSL compiler through CanvasKit.
//
// Why this exists: neither jest project can compile it. The native project mocks Skia away, and the web project never loads
// CanvasKit — so without this the shader would reach a phone having been read by nobody but its author, and a typo in it is
// not a wrong colour, it is the first screen falling back to a still poster for every user with no way to tell why.
// CanvasKit and the phone's Skia share the SkSL frontend, so what compiles here compiles there.
//
// The wasm comes from node_modules, not `public/` (which `pnpm skia:web` writes), so this has no ordering to respect. The
// glue and the binary must be the SAME build: pairing `bin/canvaskit.js` with `bin/full/canvaskit.wasm` loads, and then
// throws "invalid index N into funcref table" on the first call into it, which reads like a corrupt shader and is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const SOURCE = path.join(root, 'src/screens/firstScreen/SkiaSky.tsx');
/** The uniforms `SkiaSky` hands the shader every frame. Out of step with the shader and the sky goes black. */
const SENDS = ['res', 'time', 'calm'];

const file = fs.readFileSync(SOURCE, 'utf8');
const BUILD = path.join(root, 'node_modules/canvaskit-wasm/bin/full');
const load = (onError) => require(path.join(BUILD, 'canvaskit.js'))({
  locateFile: () => path.join(BUILD, 'canvaskit.wasm'),
  printErr: onError,
  print: () => {},
});

test('the sky shader is where this check looks for it', () => {
  assert.match(file, /const SKY_SKSL = `[\s\S]*?`;/, 'SKY_SKSL moved or was renamed: look, then update this check');
});

test('it compiles, and takes exactly the uniforms the component sends', async () => {
  const sksl = file.match(/const SKY_SKSL = `([\s\S]*?)`;/)[1];
  const errors = [];
  const CanvasKit = await load((m) => errors.push(m));
  // No error callback: this build of CanvasKit reads the second argument as a wasm function pointer and throws.
  // Compile errors arrive on `printErr` instead, which is what `errors` collects.
  const effect = CanvasKit.RuntimeEffect.Make(sksl);
  assert.ok(effect, `the sky shader does not compile:\n${errors.join('\n')}`);

  const names = Array.from({ length: effect.getUniformCount() }, (_, i) => effect.getUniformName(i));
  assert.deepEqual(names.slice().sort(), SENDS.slice().sort(), 'the shader and the component disagree about uniforms');
});

test('a shader with a typo in it fails this check, so a pass means something', async () => {
  const CanvasKit = await load(() => {});
  assert.equal(CanvasKit.RuntimeEffect.Make('half4 main(float2 xy){ return nope(xy); }'), null);
});
