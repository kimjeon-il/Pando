import { selectGeometryVersion, territorialEntityExistsAt } from '../../apps/editor/frontend/js/modules/territorial-library.js';

// The fifteen-republic partition, Crimea and Baikonur checks describe this
// late Soviet snapshot. Earlier reviewed periods have separate contracts.
export const LATE_SOVIET_CHECK_DATE = '1989-12-31';

export function selectLateSovietCheckSnapshot(entities) {
  const parent = entities.find(entity => entity.entityId === 'state:soviet-union');
  return {
    parent,
    parentVersion: parent ? selectGeometryVersion(parent, LATE_SOVIET_CHECK_DATE) : null,
    children: entities.filter(entity => entity.parentEntityId === 'state:soviet-union'
      && territorialEntityExistsAt(entity, LATE_SOVIET_CHECK_DATE))
      .map(entity => ({ entity, version: selectGeometryVersion(entity, LATE_SOVIET_CHECK_DATE) })),
  };
}
