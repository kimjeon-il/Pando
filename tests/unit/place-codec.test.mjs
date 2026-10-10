import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePlaceTile, decodePlaceTile } from '../../assets/js/modules/place-codec.js';
import { normalizePlace, PLACE_LIMITS } from '../../assets/js/modules/place-contract.js';
const raw = { source: 'synthetic', sourceId: '서울:1', name: '서울 🗺️', nameEn: 'Seoul', nameNative: '서울', nameTimeline: [{ fromYear: 1900, ko: '경성' }, { fromDate: '1945-08-15', ko: '서울 🗺️' }], kind: 'capital', coordinates: [127.12345, 37.56789], countryCode: 'KR', population: 12345678, priority: 90, minZoom: 1.25, featureCode: 'PPLC' };

test('place binary preserves canonical identity, Unicode and metadata', () => {
  const record = normalizePlace(raw);
  assert.deepEqual(decodePlaceTile(encodePlaceTile([raw])), [record]);
  assert.ok(Object.isFrozen(record) && Object.isFrozen(record.coordinates) && Object.isFrozen(record.nameTimeline));
});
test('place contract rejects invalid coordinates, identity, ranking and oversized text', () => {
  for (const patch of [{ source: 'Invalid/Source' }, { sourceId: '' }, { name: 'x'.repeat(257) }, { coordinates: [181, 0] }, { coordinates: [0, 91] }, { coordinates: [NaN, 0] }, { population: -1 }, { priority: 1e40 }, { minZoom: 1e40 }, { kind: 'invalid' }, { nameTimeline: [{ fromDate: '2000-02-30', ko: '잘못' }] }, { nameTimeline: [{ fromDate: '2020-01-01', ko: 'A' }, { fromYear: 2019, ko: 'B' }] }]) assert.throws(() => normalizePlace({ ...raw, ...patch }));
});
test('codec rejects truncation, wrong version, corrupt offsets and excess records', () => {
  const original = encodePlaceTile([raw]);
  assert.throws(() => decodePlaceTile(original.slice(0, -1)));
  for (const [offset, value] of [[4, 1], [8, 513], [16, 1], [68, 999999]]) {
    const bytes = original.slice(0); const view = new DataView(bytes);
    if (offset === 4) view.setUint16(offset, value, true); else view.setUint32(offset, value, true);
    assert.throws(() => decodePlaceTile(bytes));
  }
  assert.throws(() => encodePlaceTile(Array(PLACE_LIMITS.tileRecords + 1).fill(raw)));
});

test('v3 encoder rejects names exceeding the decoder string bound', () => {
  const timeline = Array.from({ length: 16 }, (_, index) => ({
    fromYear: 1801 + index, ko: '가'.repeat(256), en: 'A'.repeat(256), native: 'Б'.repeat(256),
  }));
  assert.throws(() => encodePlaceTile([{ ...raw, nameTimeline: timeline }]), /string byte budget/);
});


test('PLAC v3 round-trips native extras and dated three-name transitions', () => {
  const input = { ...raw, name: '니코시아', nameEn: 'Nicosia',
    nameNative: 'Λευκωσία', nameNativeExtras: ['Lefkoşa'],
    nameTimeline: [
      { fromYear: 1801, ko: '레프코샤', native: 'لفقوشه' },
      { fromDate: '1878-07-05', native: 'لفقوشه', nativeExtras: ['Nicosia', 'Λευκωσία'] },
      { fromDate: '1914-11-05', native: 'Nicosia', nativeExtras: ['Λευκωσία', 'لفقوشه'] },
      { fromYear: 1930, native: 'Nicosia', nativeExtras: ['Λευκωσία', 'Lefkoşa'] },
      { fromDate: '1960-08-16', native: 'Λευκωσία', nativeExtras: ['Lefkoşa'] },
    ] };
  const bytes = encodePlaceTile([input]), header = new DataView(bytes);
  assert.equal(header.getUint16(4, true), 3);
  assert.equal(header.getUint16(6, true), 72);
  assert.deepEqual(decodePlaceTile(bytes), [normalizePlace(input)]);
  assert.ok(Object.isFrozen(normalizePlace(input).nameNativeExtras));
  assert.ok(Object.isFrozen(normalizePlace(input).nameTimeline[1].nativeExtras));
  for (const [fieldIndex, textValue] of [[7, '{bad'], [8, '{bad']]) {
    const malformed = bytes.slice(0), view = new DataView(malformed);
    const poolStart = 32 + 72, poolOff = view.getUint32(32 + 36 + fieldIndex * 4, true);
    const offset = poolStart + poolOff + 4;
    new Uint8Array(malformed)[offset] = textValue.charCodeAt(0);
    if (fieldIndex === 7 || fieldIndex === 8) assert.throws(() => decodePlaceTile(malformed));
  }
});


test('Web PLAC v3 bytes match the shared Nicosia hex vector used by the Qt decoder', async () => {
  const { readFile } = await import('node:fs/promises');
  const file = new URL('../../contracts/places/v3.json', import.meta.url);
  const contract = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(contract.wire.version, 3);
  assert.equal(contract.wire.recordBytes, 72);
  const fixture = contract.fixtures[0];
  const hex = Buffer.from(new Uint8Array(encodePlaceTile([fixture.input]))).toString('hex');
  assert.equal(hex, fixture.tileHex);
  const rows = decodePlaceTile(Buffer.from(hex, 'hex'));
  assert.equal(rows[0].nameNative, 'Λευκωσία');
  assert.deepEqual(rows[0].nameNativeExtras, ['Lefkoşa']);
});


test('v3 Nicosia fixture stays aligned with the reviewed multilingual timeline', async () => {
  const { readFile } = await import('node:fs/promises');
  const contract = JSON.parse(await readFile(new URL('../../contracts/places/v3.json', import.meta.url), 'utf8'));
  const source = JSON.parse(await readFile(new URL('../../reports/places/tier1-major-cities-batch13-european-microstates-mediterranean.json', import.meta.url), 'utf8'));
  const city = source.records.find(record => record.geonameId === 146268);
  assert.ok(city);
  const fixture = contract.fixtures[0].input;
  assert.equal(fixture.nameNative, city.defaultNativeNames[0].text);
  assert.deepEqual(fixture.nameNativeExtras, city.defaultNativeNames.slice(1).map(name => name.text));
  assert.deepEqual(fixture.coordinates, [city.longitude, city.latitude]);
  const selected = city.displayTimeline.map(entry => ({
    start: entry.fromDate ?? entry.fromYear,
    native: entry.nativeNames[0].text,
    nativeExtras: entry.nativeNames.slice(1).map(name => name.text),
  }));
  const runtime = fixture.nameTimeline.map(entry => ({
    start: entry.fromDate ?? entry.fromYear,
    native: entry.native,
    nativeExtras: entry.nativeExtras || [],
  }));
  assert.deepEqual(runtime, selected);
});
