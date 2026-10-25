const GROUPS = Object.freeze({
  Latin: ['eng', 'deu', 'deu_latf', 'lat', 'fra', 'spa', 'ita', 'por', 'nld'],
  Hangul: ['kor', 'kor_vert'], Han: ['chi_tra', 'chi_sim', 'jpn', 'chi_tra_vert', 'chi_sim_vert', 'jpn_vert'], Japanese: ['jpn', 'jpn_vert', 'chi_tra', 'chi_tra_vert'],
  Arabic: ['ara', 'fas', 'urd'],
  Greek: ['ell', 'grc'],
  Cyrillic: ['rus', 'ukr'], Hebrew: ['heb'], Armenian: ['hye'], Georgian: ['kat'], Devanagari: ['hin'], Bengali: ['ben'],
});

export const REFERENCE_OCR_LANGUAGES = Object.freeze([...new Set(Object.values(GROUPS).flat())]);
export function referenceOcrLanguagesForScript(script) {
  return [...(GROUPS[script] || REFERENCE_OCR_LANGUAGES)];
}

export function referenceOcrBlocks(data) {
  const blocks = [];
  for (const block of data.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
    const text = String(line.text || '').trim();
    const b = line.bbox;
    if (!text || !b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) || b.x1 <= b.x0 || b.y1 <= b.y0) continue;
    blocks.push({ rawValue: text, confidence: Math.max(0, Math.min(1, Number(line.confidence || 0) / 100)),
      boundingBox: { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 } });
  }
  return blocks;
}

export function referenceOcrOriginalBox(box, width, height, degrees) {
  const { x, y, width: w, height: h } = box;
  if (degrees === 90) return { x: y, y: height - x - w, width: h, height: w };
  if (degrees === 180) return { x: width - x - w, y: height - y - h, width: w, height: h };
  if (degrees === 270) return { x: width - y - h, y: x, width: h, height: w };
  return box;
}
