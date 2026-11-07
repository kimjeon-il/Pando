// Detached, zero-I/O source geometry. Every call owns its vertex arrays.
export function rectanglePolygon(west, south, east, north) {
  if (![west, south, east, north].every(Number.isFinite) || east <= west || north <= south)
    throw new RangeError('Invalid synthetic rectangle');
  return {type: 'Polygon', coordinates: [[
    [west, south], [east, south], [east, north], [west, north], [west, south],
  ]]};
}
