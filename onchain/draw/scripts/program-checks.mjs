// #406 Phase 1: the draw program's guarantees, against the deployed devnet program.
// Usage: node scripts/program-checks.mjs
// Keys: ~/.config/solana/gachapon/phase0-deployer.json (upgrade authority), devnet-requester.json (draw authority).
import anchor from '@coral-xyz/anchor';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const { AnchorProvider, Program, Wallet, web3, BN } = anchor;
const QUEUE = new web3.PublicKey('Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh');
const idl = JSON.parse(readFileSync(new URL('../idl/draw.json', import.meta.url)));
const key = (name) => web3.Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/gachapon/${name}.json`))));
const deployer = key('phase0-deployer');
const requester = key('devnet-requester');
const connection = new web3.Connection(process.env.DEVNET_RPC ?? 'https://api.devnet.solana.com', 'confirmed');
const programAs = (kp) => new Program(idl, new AnchorProvider(connection, new Wallet(kp), { commitment: 'confirmed' }));
const asRequester = programAs(requester);
const asDeployer = programAs(deployer);
const pid = asRequester.programId;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const pda = (...seeds) => web3.PublicKey.findProgramAddressSync(seeds, pid)[0];
const config = pda(Buffer.from('config'));
const PAGE_BITS = 10_224 * 8;
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const errorName = (e) => e?.error?.errorCode?.code ?? (String(e?.message ?? e).match(/already in use|custom program error: 0x[0-9a-f]+/)?.[0]) ?? String(e?.message ?? e).split('\n')[0].slice(0, 120);
async function refused(fn) { try { await fn(); return null; } catch (e) { return errorName(e); } }

// Draw layout after the discriminator: sequence @8 | pull_id @16 | pool_hash @48 | randomness @80 | request_slot @112 | fulfilled_slot @120
const readDraw = async (draw) => {
  const info = await connection.getAccountInfo(draw, 'confirmed');
  if (!info) return null;
  const b = Buffer.from(info.data);
  return { randomness: b.subarray(80, 112).toString('hex'), requestSlot: b.readBigUInt64LE(112), fulfilledSlot: b.readBigUInt64LE(120) };
};

const request = (program, signer, sequence, poolHash = createHash('sha256').update('pool').digest()) => {
  const page = Math.floor(sequence / PAGE_BITS);
  return program.methods.requestDraw(new BN(sequence), [...randomBytes(32)], 1, [...poolHash])
    .accountsPartial({ authority: signer.publicKey, config, used: pda(Buffer.from('used'), u32(page)),
      draw: pda(Buffer.from('draw'), u64(sequence)), oracleQueue: QUEUE })
    .rpc({ commitment: 'confirmed' });
};

// 1. Config, set by the upgrade authority, naming the requester.
if (!(await connection.getAccountInfo(config))) {
  const programData = web3.PublicKey.findProgramAddressSync([pid.toBuffer()], new web3.PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];
  await asDeployer.methods.initialize(requester.publicKey)
    .accountsPartial({ upgradeAuthority: deployer.publicKey, config, program: pid, programData })
    .rpc({ commitment: 'confirmed' });
  console.log('initialized config with authority', requester.publicKey.toBase58());
}
const programData = web3.PublicKey.findProgramAddressSync([pid.toBuffer()], new web3.PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];
check('set_authority refuses a signer that is not the upgrade authority',
  (await refused(() => asRequester.methods.setAuthority(requester.publicKey)
    .accountsPartial({ upgradeAuthority: requester.publicKey, config, program: pid, programData }).rpc())) === 'NotUpgradeAuthority');

// 2. Page 0, opened by the requester only.
const page0 = pda(Buffer.from('used'), u32(0));
if (!(await connection.getAccountInfo(page0))) {
  await asRequester.methods.initPage(0).accountsPartial({ authority: requester.publicKey, config, used: page0 }).rpc({ commitment: 'confirmed' });
  console.log('opened used page 0');
}
check('init_page refuses a signer that is not the draw authority',
  (await refused(() => asDeployer.methods.initPage(1)
    .accountsPartial({ authority: deployer.publicKey, config, used: pda(Buffer.from('used'), u32(1)) }).rpc())) === 'NotAuthority');

// 3. A draw by a non-authority is refused.
check('request_draw refuses a signer that is not the draw authority',
  (await refused(() => request(asDeployer, deployer, randomInt(1, PAGE_BITS)))) === 'NotAuthority');

// 4. One draw, fulfilled.
const sequence = randomInt(1, PAGE_BITS);
const t0 = Date.now();
await request(asRequester, requester, sequence);
const draw = pda(Buffer.from('draw'), u64(sequence));
let state = null;
for (let i = 0; i < 120; i++) { state = await readDraw(draw); if (state && state.fulfilledSlot !== 0n) break; await sleep(500); }
check('request_draw is fulfilled by MagicBlock', state?.fulfilledSlot > 0n, `sequence ${sequence}, ${Date.now() - t0} ms, randomness ${state?.randomness.slice(0, 16)}…`);

// 5. AC-2, account open.
check('AC-2: a second request for the same sequence is refused (account open)',
  (await refused(() => request(asRequester, requester, sequence))) !== null);

// 6. Close, then AC-2 again: the used bit, not the account, refuses it.
await asRequester.methods.closeDraw().accountsPartial({ authority: requester.publicKey, config, draw }).rpc({ commitment: 'confirmed' });
check('close_draw returns the fulfilled draw account', (await connection.getAccountInfo(draw, 'confirmed')) === null);
const afterClose = await refused(() => request(asRequester, requester, sequence));
check('AC-2: a second request for the same sequence is refused after close (used bit)', afterClose === 'AlreadyRequested', `refused with ${afterClose}`);

// 7. A pending draw cannot be closed. Request and close in one transaction, so no callback can land in between.
const seq2 = randomInt(1, PAGE_BITS);
const draw2 = pda(Buffer.from('draw'), u64(seq2));
const reqIx = await asRequester.methods.requestDraw(new BN(seq2), [...randomBytes(32)], 1, [...randomBytes(32)])
  .accountsPartial({ authority: requester.publicKey, config, used: page0, draw: draw2, oracleQueue: QUEUE }).instruction();
const closeIx = await asRequester.methods.closeDraw().accountsPartial({ authority: requester.publicKey, config, draw: draw2 }).instruction();
const pendingClose = await refused(() => asRequester.provider.sendAndConfirm(new web3.Transaction().add(reqIx, closeIx), [], { commitment: 'confirmed' }));
check('close_draw refuses a draw that is still pending', pendingClose === 'StillPending' || /0x1775/.test(pendingClose ?? ''), `refused with ${pendingClose}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
