import assert from 'node:assert/strict';
import test from 'node:test';
import { builtinHydroSourceNotes } from "../../apps/editor/frontend/js/modules/object-property-presentation.js";

test('source notes are omitted for rivers not enriched with OpenStreetMap data', () => {
  assert.equal(builtinHydroSourceNotes({ source: 'HydroRIVERS 1.0', osm_relation_ids: [] }), '');
  assert.equal(builtinHydroSourceNotes({ source: 'HydroRIVERS 1.0 · Natural Earth border KAZ/RUS' }), '');
});

test('source notes credit OpenStreetMap, its licence, and specific waterway relations', () => {
  const notes = builtinHydroSourceNotes({
    source: 'HydroRIVERS 1.0 · Natural Earth border KAZ/RUS',
    osm_relation_ids: [1234, 1234, 5678],
  });
  assert.match(notes, /© OpenStreetMap contributors/);
  assert.match(notes, /ODbL 1.0/);
  assert.match(notes, /https:\/\/www\.openstreetmap\.org\/relation\/1234/);
  assert.match(notes, /https:\/\/www\.openstreetmap\.org\/relation\/5678/);
  assert.equal(notes.match(/relation\/1234/g)?.length, 1);
});

test('legacy core-only OSM name evidence still gets licence attribution', () => {
  const notes = builtinHydroSourceNotes({ source: 'HydroRIVERS 1.0 · OSM waterway names' });
  assert.match(notes, /© OpenStreetMap contributors/);
  assert.doesNotMatch(notes, /relation\/\d+/);
});

test('verified independent references appear exactly once and no ODbL remains on OSM-free river', () => {
  const notes = builtinHydroSourceNotes({
    source: 'HydroRIVERS 1.0 · independently verified river names',
    independent_source_urls: ['https://www.naturalearthdata.com/', 'https://www.gov.pl/', 'https://www.gov.pl/'],
    osm_relation_ids: [],
  });
  assert.match(notes, /OSM 대체/);
  assert.match(notes, /naturalearthdata/);
  assert.equal(notes.match(/https:\/\/www\.gov\.pl\//g)?.length, 1);
  assert.doesNotMatch(notes, /© OpenStreetMap contributors/);
});

test('remaining OSM relation still credits ODbL when independent sources are also present', () => {
  const notes = builtinHydroSourceNotes({
    source: 'HydroRIVERS 1.0',
    independent_source_urls: ['https://www.naturalearthdata.com/'],
    osm_relation_ids: [123456],
  });
  assert.match(notes, /OSM 대체/);
  assert.match(notes, /© OpenStreetMap contributors/);
});
