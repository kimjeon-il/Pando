// Input-boundary conversion only. Never rewrite arbitrary strings in user metadata.
const legacyTypes = new Set(['territory', 'admin']);
const groupFor = type => type === 'admin' ? 'administrative' : 'territories';
const objectKey = (type, id) => `territorial:${type}:${id}`;

export function migrateTerritorialObjectKey(key) {
  return typeof key === 'string' ? key.replace(/^territorial:(territory|admin):/, 'territorial:subunit:') : key;
}

export function migrateTerritorialInput(feature) {
  const next = structuredClone(feature);
  const properties = next?.properties;
  if (!properties) return next;
  delete properties.adminLevel;
  delete properties.isRemainder;
  if (properties.metadata) delete properties.metadata.legacyTerritorialPartition;
  if (!legacyTypes.has(properties.unitType)) return next;
  properties.unitType = 'subunit';
  properties.schemaVersion = 2;
  return next;
}

export function migrateProjectV4ToV5(input) {
  if (Number(input?.schemaVersion) !== 4) throw new Error('Project v4 migration requires schemaVersion 4.');
  const project = structuredClone(input);
  const oldUnits = project.territorialUnits || [];
  const presentation = project.layerPresentation || { styles: {} };
  const objectStyles = { ...presentation.objectStyles };
  const objectOrder = [...(presentation.objectOrder || [])].map(migrateTerritorialObjectKey);
  const sourceOrder = [...new Set([...(presentation.overlayOrder || []), 'distributions', 'administrative', 'territories', 'regions', 'genericFeatures'])];
  for (const group of sourceOrder) {
    for (const feature of oldUnits) {
      const type = feature.properties?.unitType;
      if (!legacyTypes.has(type) || groupFor(type) !== group) continue;
      const key = objectKey('subunit', feature.id);
      objectOrder.push(key);
      objectStyles[key] = structuredClone(presentation.styles?.[group] || {});
    }
  }
  const visible = { ...project.itemVisibility?.subunits };
  for (const feature of oldUnits) {
    const type = feature.properties?.unitType;
    if (type === 'subunit') {
      visible[feature.id] = project.layerVisibility?.subunits !== false && visible[feature.id] !== false;
      continue;
    }
    if (!legacyTypes.has(type)) continue;
    const group = groupFor(type);
    visible[feature.id] = project.layerVisibility?.[group] !== false
      && project.itemVisibility?.[group]?.[feature.id] !== false;
  }
  project.territorialUnits = oldUnits.map(feature => {
    const next = migrateTerritorialInput(feature);
    next.properties.schemaVersion = 2;
    return next;
  });
  project.layerVisibility = { ...project.layerVisibility, subunits: true };
  project.itemVisibility = { ...project.itemVisibility, subunits: visible };
  for (const group of ['territories', 'administrative']) {
    delete project.layerVisibility[group];
    delete project.itemVisibility[group];
  }
  const styles = { ...presentation.styles, subunits: presentation.styles?.subunits || {} };
  delete styles.territories;
  delete styles.administrative;
  project.layerPresentation = {
    ...presentation, schemaVersion: 3, styles, objectStyles,
    objectOrder: [...new Set(objectOrder)],
    overlayOrder: [...new Set(sourceOrder.map(group => ['territories', 'administrative'].includes(group) ? 'subunits' : group))],
  };
  project.territorialModel = { ...project.territorialModel, schemaVersion: 2, types: ['country', 'subunit', 'region'] };
  for (const field of ['selected', 'selectionAnchor']) {
    const ref = project[field];
    if (ref?.domain !== 'territorial' || !legacyTypes.has(ref.type)) continue;
    ref.type = 'subunit';
    if (ref.key) ref.key = migrateTerritorialObjectKey(ref.key);
  }
  project.schemaVersion = 5;
  return project;
}
