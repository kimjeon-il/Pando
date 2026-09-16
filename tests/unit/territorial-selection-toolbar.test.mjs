import assert from 'node:assert/strict';
import test from 'node:test';
import { createPropertySelection } from '../../assets/js/modules/app-property-selection.js';
import { OBJECT_EDITING_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';

test('territorial selection presents the toolbar without automatically opening the editor', () => {
  const intents = [];
  const propertySelection = createPropertySelection();
  propertySelection.connect(capabilityPortsForFixture(OBJECT_EDITING_OWNER_PORTS.propertySelection, {
    TERRITORIAL_UNIT_TYPES: { COUNTRY: 'country', SUBUNIT: 'subunit', REGION: 'region' },
    countryObjectRef: id => ({ domain: 'territorial', type: 'country', id: String(id), key: `territorial:country:${id}` }),
    normalizeObjectRef: ref => ({ ...ref, key: `${ref.domain}:${ref.type}:${ref.id}` }),
    territorialUnitById: id => id === 'subunit-1'
      ? { id, properties: { unitType: 'subunit' } }
      : null,
    selectionUiController: {
      applyIntent: (ref, options) => {
        intents.push({ ref, options });
        return true;
      },
    },
  }));

  assert.equal(propertySelection.applyCountrySelectionIntent('DEU'), true);
  assert.equal(propertySelection.applyTerritorialUnitSelectionIntent('subunit-1'), true);
  assert.deepEqual(intents.map(intent => intent.options.openEditor), [false, false]);
  assert.deepEqual(intents.map(intent => intent.ref.type), ['country', 'subunit']);
});
