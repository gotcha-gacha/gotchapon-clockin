// The CSV is the machine source of truth. The JSON the app imports is the same table.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientCatalog, loadV0Catalog, readClientCatalog } from '../v0-catalog.mjs';

const albums = await loadV0Catalog();

test('the locked catalog is 75 SKUs across A, B and C, with exclusive species names', () => {
  assert.deepEqual(albums.map((album) => album.id), ['A', 'B', 'C']);
  assert.equal(albums.reduce((sum, album) => sum + album.cards.length, 0), 75);
  const names = albums.flatMap((album) => album.cards.map((card) => card.name));
  const ids = albums.flatMap((album) => album.cards.map((card) => card.id));
  assert.equal(new Set(names).size, 75);
  assert.equal(new Set(ids).size, 75);
});

test('C5 is Rolycoly sv5-93 and C15 is Wimpod sv4-47; A keeps Girafarig and B keeps Foongus', () => {
  const card = (albumId: string, slot: number) => albums.find((album) => album.id === albumId)!.cards[slot - 1];
  assert.deepEqual([card('C', 5).id, card('C', 5).name], ['sv5-93', 'Rolycoly']);
  assert.deepEqual([card('C', 15).id, card('C', 15).name], ['sv4-47', 'Wimpod']);
  assert.deepEqual([card('A', 20).id, card('A', 20).name], ['sv6-83', 'Girafarig']);
  assert.deepEqual([card('B', 7).id, card('B', 7).name], ['sv3-9', 'Foongus']);
  const ids = new Set(albums.flatMap((album) => album.cards.map((row) => row.id)));
  assert.equal(ids.has('sv5-66'), false); // design cards.js C5, Girafarig
  assert.equal(ids.has('sv9-10'), false); // design cards.js C15, Foongus
});

test('the client JSON is the CSV, not a second list', async () => {
  assert.deepEqual(await readClientCatalog(), clientCatalog(albums));
});
