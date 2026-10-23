// Conservative frame candidates, not a learned assertion of map semantics.
export function detectReferenceMapLines(raster) {
  const { width, height, data } = raster;
  if (![width, height].every(v => Number.isInteger(v) && v > 0) || data.length !== width * height * 4) throw new TypeError('Invalid layout raster.');
  const dark = (x, y) => {
    const i = (y * width + x) * 4;
    return data[i + 3] > 128 && data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722 < 145;
  };
  function runs(vertical) {
    const count = vertical ? width : height, length = vertical ? height : width, rows = [];
    const minimum = Math.max(24, Math.round(length * .14));
    for (let axis = 0; axis < count; axis++) {
      let start = -1, last = -1;
      const finish = () => {
        if (start >= 0 && last - start + 1 >= minimum) {
          const duplicate = rows.find(row => axis - row.axis <= 2 && Math.abs(row.start - start) <= 2 && Math.abs(row.end - last) <= 2);
          if (!duplicate) rows.push({ axis, start, end: last });
        }
        start = -1;last = -1;
      };
      for (let i = 0; i < length; i++) {
        if (vertical ? dark(axis, i) : dark(i, axis)) { if (start < 0) start = i;last = i; }
        else if (last >= 0 && i - last > 2) finish();
      }
      finish();
    }
    return rows.sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 96);
  }
  return { horizontal: runs(false), vertical: runs(true) };
}

export function detectReferenceMapLayout(raster, { blocks = [] } = {}) {
  const { width, height } = raster;
  const { horizontal, vertical } = detectReferenceMapLines(raster), candidates = [];
  for (const top of horizontal) for (const bottom of horizontal) {
    if (bottom.axis - top.axis < 24 || Math.abs(top.start - bottom.start) > 3 || Math.abs(top.end - bottom.end) > 3) continue;
    const left = top.start, right = top.end;
    const side = x => vertical.some(row => Math.abs(row.axis - x) <= 3 && row.start <= top.axis + 3 && row.end >= bottom.axis - 3);
    if (!side(left) || !side(right)) continue;
    const rect = { x: left, y: top.axis, width: right - left + 1, height: bottom.axis - top.axis + 1 };
    if (rect.width * rect.height < width * height * .01) continue;
    if (candidates.some(row => ['x', 'y', 'width', 'height'].every(key => Math.abs(row[key] - rect[key]) <= 4))) continue;
    candidates.push(rect);
  }
  candidates.sort((a, b) => b.width * b.height - a.width * a.height);
  const panels = candidates.slice(0, 12).map((sourceRect, index) => {
    const evidence = blocks.filter(block => {
      const box = block.boundingBox, x = box.x + box.width / 2, y = box.y + box.height / 2;
      return x > sourceRect.x && x < sourceRect.x + sourceRect.width && y > sourceRect.y && y < sourceRect.y + sourceRect.height;
    });
    const legend = index > 0 && evidence.some(block => /^(?:legend|key|l[eé]gende|legende|범례|圖例|图例|凡例|راهنما|مفتاح)(?:\s|$)/iu.test(block.rawValue.trim()));
    return { id: `panel:${sourceRect.x}:${sourceRect.y}:${sourceRect.width}:${sourceRect.height}`, sourceRect,
      kind: legend ? 'legend' : index === 0 ? 'main' : 'inset', requiresReview: index > 0 && !legend };
  });
  return { width, height, panels };
}
