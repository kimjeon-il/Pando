import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exchangeContent, exchangeTrace } from '../../tools/parity/exchange.mjs';
import { compareObservations } from '../../tools/parity/contract.mjs';
const fixture = name => JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/' + name, import.meta.url)));
test('current JSON/Worker exchange retains independently specified timeline content', async () => {
  const expected = exchangeContent(fixture('static.expected.json'));
  const trace = await exchangeTrace(fixture('static.json'), 'json', () => {});
  assert.deepEqual(trace, { stages: [expected, expected, expected], activation: 'OK' });
});
test('reserved object keys remain observable IDs with duplicate detection',()=>{
  for(const id of ['__proto__','constructor','toString']) {
    const expected=fixture('static.expected.json');expected.territorialEntities[0].id=id;
    const changed=structuredClone(expected);changed.territorialEntities[0].properties.name='changed';
    const differences=compareObservations(exchangeContent(expected),exchangeContent(changed),exchangeContent(expected));
    assert.equal(differences.length,1);assert.equal(differences[0].path,'/territorialEntities/'+id+'/properties/name');
    expected.territorialEntities.push(expected.territorialEntities[0]);
    assert.throws(()=>exchangeContent(expected),/Duplicate/);
  }
});
test('exchange normalization only rekeys declared collections and detects duplicates', () => {
  const source = fixture('static.expected.json'), expected = exchangeContent(source);
  source.territorialEntities.reverse();
  assert.deepEqual(exchangeContent(source), expected);
  source.geometries.find(row => row.id === 'shape' && row.version === 1).geojson.coordinates[0][0].reverse();
  assert.notDeepEqual(exchangeContent(source), expected);
  source.territorialEntities.push(source.territorialEntities[0]);
  assert.throws(() => exchangeContent(source), /Duplicate/);
});
