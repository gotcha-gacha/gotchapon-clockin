import { readFile, writeFile } from 'node:fs/promises';

/**
 * The v0 pull-pool source of truth (#313): albums A, B and C, 75 SKUs.
 * `data/catalog/gachapon-v0-albums-75.csv` is the file the seed loads.
 * `data/catalog/v0-albums.json` is the same table for the app (Metro imports JSON).
 * `server/scripts/__tests__/v0-catalog.test.ts` fails if the two diverge.
 *
 * Subtitles are album chrome, not SKU columns. They match the design pack.
 */
export const ALBUM_SUBTITLES = {
  A: '25 glowing critters',
  B: '25 from the shallows',
  C: '25 from every path',
};

const COLUMNS = ['album_id', 'album_title', 'slot', 'card_id', 'name', 'set', 'types', 'img', 'img_hires'];

/** One CSV record. Fields are unquoted in the locked file; quotes are accepted so a comma in a name cannot split a row. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((record) => record.some((value) => value.length > 0));
}

function splitSet(label, cardId) {
  const match = /^(\S+)\s+(\S+)$/.exec(label.trim());
  if (!match) throw new Error(`${cardId}: set label ${JSON.stringify(label)} is not "SET NUMBER"`);
  return { set: match[1], number: match[2] };
}

/**
 * The locked 75. Throws if the file is not three albums of 25, slots 1–25, with exclusive species names and card ids.
 */
export function parseV0Catalog(csv) {
  const records = parseCsv(csv);
  const header = records[0]?.map((cell) => cell.trim());
  if (!header || header.join(',') !== COLUMNS.join(',')) {
    throw new Error(`catalog header must be ${COLUMNS.join(',')}`);
  }
  const albums = new Map();
  const seenIds = new Map();
  const seenNames = new Map();
  for (const record of records.slice(1)) {
    if (record.length !== COLUMNS.length) throw new Error(`catalog row has ${record.length} columns: ${record.join('|')}`);
    const value = Object.fromEntries(COLUMNS.map((column, index) => [column, record[index].trim()]));
    const slot = Number(value.slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > 25) throw new Error(`${value.card_id}: slot ${value.slot} is not 1–25`);
    if (seenIds.has(value.card_id)) throw new Error(`duplicate card id ${value.card_id}`);
    if (seenNames.has(value.name)) throw new Error(`species name ${value.name} is in ${seenNames.get(value.name)} and ${value.album_id}`);
    seenIds.set(value.card_id, value.album_id);
    seenNames.set(value.name, value.album_id);
    const { set, number } = splitSet(value.set, value.card_id);
    const album = albums.get(value.album_id) ?? { id: value.album_id, title: value.album_title, cards: [] };
    if (album.title !== value.album_title) throw new Error(`album ${value.album_id} has two titles`);
    album.cards.push({
      slot, id: value.card_id, name: value.name, set, number, types: value.types,
      rarity: 'Common', imgSmall: value.img, imgLarge: value.img_hires,
    });
    albums.set(value.album_id, album);
  }
  const ordered = ['A', 'B', 'C'].map((id) => {
    const album = albums.get(id);
    if (!album) throw new Error(`album ${id} is missing`);
    if (!ALBUM_SUBTITLES[id]) throw new Error(`album ${id} has no subtitle`);
    album.cards.sort((a, b) => a.slot - b.slot);
    if (album.cards.length !== 25) throw new Error(`album ${id} has ${album.cards.length} cards`);
    album.cards.forEach((card, index) => {
      if (card.slot !== index + 1) throw new Error(`album ${id} slot ${index + 1} is missing`);
    });
    return { ...album, sub: ALBUM_SUBTITLES[id] };
  });
  if (albums.size !== 3) throw new Error(`catalog has albums ${[...albums.keys()].join(',')} — live pull pool is A, B and C only`);
  return ordered;
}

export async function loadV0Catalog() {
  const csv = await readFile(new URL('../../data/catalog/gachapon-v0-albums-75.csv', import.meta.url), 'utf8');
  return parseV0Catalog(csv);
}

/** The JSON the app imports. Same cards as the CSV, plus the subtitle chrome. */
export function clientCatalog(albums) {
  return {
    albums: albums.map((album) => ({
      id: album.id, title: album.title, sub: album.sub,
      cards: album.cards.map((card) => ({
        id: card.id, slot: card.slot, name: card.name, set: card.set, number: card.number,
        types: card.types, rarity: card.rarity, imgSmall: card.imgSmall, imgLarge: card.imgLarge,
      })),
    })),
  };
}

const clientJsonUrl = new URL('../../data/catalog/v0-albums.json', import.meta.url);

export async function readClientCatalog() {
  return JSON.parse(await readFile(clientJsonUrl, 'utf8'));
}

if (process.argv[1] && process.argv[1].endsWith('v0-catalog.mjs') && process.argv.includes('--write-client')) {
  const json = `${JSON.stringify(clientCatalog(await loadV0Catalog()), null, 2)}\n`;
  await writeFile(clientJsonUrl, json);
  console.log(`Wrote ${clientJsonUrl.pathname}`);
}
