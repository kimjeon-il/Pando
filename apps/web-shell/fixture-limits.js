/** Trial import bound, checked before installing anything in the live document. */
export function assertSmallProject(project) {
  if (!Array.isArray(project?.territorialEntities) || project.territorialEntities.length > 20) throw new Error('시험용 앱은 객체 20개 이하만 열 수 있습니다.');
  let coordinates = 0;
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      if (++coordinates > 100) throw new Error('시험용 앱은 좌표 100개 이하만 열 수 있습니다.');
    } else for (const child of value) visit(child);
  }
  for (const geometry of project.geometries || []) visit(geometry.geojson?.coordinates);
  return project;
}
