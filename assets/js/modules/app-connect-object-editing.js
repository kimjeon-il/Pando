import { OBJECT_EDITING_OWNER_PORTS } from './app-capability-ports-object-editing.js';
import { connectCapabilityOwners } from './app-capability-port-utils.js';

/** Explicit capability wiring; no state ownership or event registration. */
export function connectObjectEditing({
  ports,
  territorySelectionWorkflow,
  countryCommits,
  genericCommands,
  propertySelection,
  territorialDrafts,
  colorPicker,
  objectMetadata,
  territorialConversion,
  projectSnapshots,
}) {
  connectCapabilityOwners(OBJECT_EDITING_OWNER_PORTS, {
    territorySelectionWorkflow,
    countryCommits,
    genericCommands,
    propertySelection,
    territorialDrafts,
    colorPicker,
    objectMetadata,
    territorialConversion,
    projectSnapshots,
  }, ports);
}
