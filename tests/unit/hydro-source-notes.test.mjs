import assert from 'node:assert/strict';
import test from 'node:test';
import { builtinHydroSourceNotes } from '../../assets/js/modules/object-property-presentation.js';

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
