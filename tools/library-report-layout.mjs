import { posix } from 'node:path';

export const REPORT_SUBJECTS = Object.freeze({ borders: '국경·영토·해안선', hydro: '강·호수·수계', places: '도시·지명', terrain: '지형', 'map-analysis': '지도 분석·학습', development: '앱·웹 개발' });
export function developmentSubject(name) {
  if (/storage|cleanup|cache|library-report|report-completion|report-organization|branch-originals|data-version|git-history|library-centralization|legacy-world-asset/i.test(name)) return 'storage';
  if (/qgis|plugin|mcp/i.test(name)) return 'integrations';
  if (/release|deploy|publish|publication|branch.*integrat|branches.*main|main.*merge|main-sync|repository-unification/i.test(name)) return 'releases';
  if (/native|android|windows|qt-app|tauri|verification-build|profile|packag|dev-launch|offline|portable|web-shell|remote-development|remote-toolchain/i.test(name)) return 'native';
  if (/ci-|ci_|core-ci|check-automation|validation-audit|p2-generated|p4-python|p5-6-final/i.test(name)) return 'ci';
  if (/performance|latency|calculation|optimization|soviet|spatial|packed|mesh-worker|predicate|russia-edit|shared-core|^p\d|objects-timeline/i.test(name)) return 'performance';
  if (/render|terrain|canvas|globe|webgl|stroke|coast|border/i.test(name)) return 'rendering';
  if (/ui|editor|view|menu|focus|search|project|object|selection|visibility|interaction|product|source-|shared|internal-naming|console|historical-world|map-|initial-map|info-tab|editing|temporal|country-lifetime|editable|evidence|empty-time/i.test(name)) return 'ui';
  throw Error(`Unclassified development report requires review: ${name}`);
}
// This is the migration classifier, not an old-path alias in the path resolver.
export function organizedReportPath(path) {
  if (!path.startsWith('reports/')) throw Error(`Not a report path: ${path}`);
  const tail = path.slice(8), parts = tail.split('/'), group = parts.shift(), rest = parts.join('/');
  if (['README.md', 'TEMPLATE.md'].includes(group) && !rest) return path;
  if (group === 'MIGRATION.md' && !rest) return 'reports/development/storage/MIGRATION.md';
  if (Object.hasOwn(REPORT_SUBJECTS, group) && !(group === 'development' && (rest === 'testing' || rest.startsWith('testing/') || rest.startsWith('qgis-')))) return path;
  if (group === 'hydro-names') return 'reports/hydro/names/' + rest;
  if (group === 'hydro-calibration') return 'reports/hydro/calibration/' + rest;
  if (group === 'hydro-connectivity') return 'reports/hydro/connectivity/' + rest;
  if (/^hydro-v\d/.test(group)) return 'reports/hydro/releases/' + group.slice(6) + '/' + rest;
  if (group === 'reference-analysis') {
    if (/^(corpus|models)(\/|$)/.test(rest)) return 'reports/map-analysis/' + rest;
    if (/cleanup|storage|cache|centralization/.test(rest.split('/')[0])) return 'reports/development/storage/' + rest;
    return 'reports/map-analysis/reports/' + rest;
  }
  if (group === 'research') return rest === 'siachen' || rest.startsWith('siachen/') ? 'reports/borders/reconstruction/siachen' + rest.slice(7) : 'reports/borders/data/' + (rest === 'README.md' ? 'research-index.md' : rest);
  if (group === 'territorial-integration') return 'reports/borders/validation/territorial-integration/' + rest;
  if (group === 'images') return 'reports/development/ui/' + rest;
  if (group === 'archive') return rest.startsWith('hydro/') ? 'reports/hydro/archive/' + rest.slice(6) : 'reports/development/storage/archive/' + rest;
  if (group === 'development') {
    if (rest === 'testing') return 'reports/development';
    if (rest.startsWith('testing/')) { const item = rest.slice(8); return 'reports/development/' + developmentSubject(item.split('/')[0]) + '/' + item; }
    if (rest.startsWith('qgis-')) return 'reports/development/integrations/' + rest;
  }
  if (group === 'geography') {
    if (/^osm-hydro|^hydro\//.test(rest)) return 'reports/hydro/' + (rest.startsWith('hydro/') ? 'validation/' + rest.slice(6) : 'names/' + rest);
    if (/^country-lifetime|^verified-entity-lifetimes/.test(rest)) return 'reports/borders/history/lifetimes/' + rest;
    if (/^historical-timeline/.test(rest)) return 'reports/borders/history/timeline/' + rest;
    if (/^border-aa|^north-korea-border-stroke/.test(rest)) return 'reports/development/rendering/' + rest;
    if (/^country-files|^country-loading|^country-geometry|^ne-selected/.test(rest)) return 'reports/borders/data/' + rest;
    if (/^germany\//.test(rest)) return 'reports/borders/reconstruction/' + rest;
    if (/^east-germany/.test(rest)) return 'reports/borders/reconstruction/germany/' + rest;
    if (/^(netherlands|serbia)\//.test(rest)) return 'reports/borders/reconstruction/' + rest;
    if (/^(diagnostics|evidence|images|reviews)\//.test(rest)) return 'reports/borders/validation/' + rest;
    return 'reports/borders/reconstruction/' + rest;
  }
  throw Error(`Unknown report category requires review: ${path}`);
}

export function rewriteReportLinks(text, from, to, mapping) {
  const map = value => {
    const edited = /^(reports\/\.edits\/[^/]+\/)(.+)$/.exec(value);
    if (edited) return edited[1] + map('reports/' + edited[2]).slice(8);
    if (/^reports\/(?:README\.md|(?:borders|hydro|places|terrain|map-analysis|development)\/README\.md)$/.test(value)) return value;
    if (mapping[value]) return mapping[value];
    if (/^reports\/reference-analysis\/?$/.test(value)) return 'reports/map-analysis/';
    if (/^reports\/geography\/?$/.test(value)) return 'reports/borders/';
    if (value.startsWith('reports/')) { try { return organizedReportPath(value); } catch { return value; } }
    return value;
  };
  // Absolute current report paths may occur in source lists and catalogues.
  const direct = text.replace(/(?:https?:\/\/[^\s<>"')]+)|reports\/[\w./-]+/g, value => value.startsWith('http') ? value : map(value));
  return direct.replace(/(\]\(|\b(?:src|href)=["'])([^\s)"']+)(["']?)/g, (whole, prefix, url, suffix) => {
    if (/^(?:[a-z]+:|\/|#)/i.test(url)) return whole;
    const [file, anchor = ''] = url.split(/(?=[?#])/s, 2);
    const oldTarget = posix.normalize(posix.join(posix.dirname(from), file));
    const target = map(oldTarget);
    const relative = posix.relative(posix.dirname(to), target);
    return prefix + relative + anchor + suffix;
  });
}

export function rewriteReportArtifact(text, from, to, mapping) {
  if (!from.endsWith('.json')) {
    const result = rewriteReportLinks(text, from, to, mapping);
    return from === 'reports/TEMPLATE.md' && !result.includes('## 보관 경로') ? result.trimEnd() + '\n\n## 보관 경로\n\n[주제 색인](README.md)에서 `borders`, `hydro`, `places`, `terrain`, `map-analysis`, `development` 중 하나를 선택한다. 보고서와 첨부는 같은 작업 묶음에 보관하고, Node/Python 경로 helper에는 `reports/<주제>/<작업 범위>`를 직접 전달한다. 완료된 범위만 라이브러리에 보관·커밋·푸시·원격 검증한다.\n' : result;
  }
  let changed = false;
  const walk = value => {
    if (typeof value === 'string' && /reports[\\/]/.test(value)) {
      const updated = rewriteReportLinks(value.replaceAll('\\', '/'), from, to, mapping);
      changed ||= updated !== value; return updated;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  const result = walk(JSON.parse(text));
  return changed ? JSON.stringify(result, null, 2) + '\n' : text;
}

export function reportDocumentDetails(documents, mapping) {
  const details = {};
  for (const [path, text] of Object.entries(documents)) {
    const target = mapping[path] || path, heading = /^#\s+(.+)$/m.exec(text);
    details[target] = { title: heading?.[1] || path.split('/').at(-1), id: /\b(?:GEO|DEV|UI|OBJ|PERF|PL)-[A-Z0-9-]+/.exec(text.slice(0, 2500))?.[0] || '', status: /상태\s*[:：]\s*`?([^\n|`]+)/.exec(text.slice(0, 2500))?.[1]?.trim() || '원문 참조', date: /(?:작성일|작성 날짜)\s*[:：]\s*(\d{4}-\d\d-\d\d)/.exec(text.slice(0, 2500))?.[1] || '' };
  }
  const originalIndex = documents['reports/README.md'] || '';
  for (const line of originalIndex.split('\n')) {
    const cells = line.split('|').slice(1, -1).map(x => x.trim());
    const link = cells[1] && /\[([^\]]+)\]\(([^)]+)\)/.exec(cells[1]);
    if (!link || cells.length < 5 || !cells[0].includes('`')) continue;
    const path = posix.normalize(posix.join('reports', link[2]));
    details[mapping[path] || path] = { title: link[1], id: cells[0].replaceAll('`', ''), date: cells[2], status: cells[3] };
  }
  return details;
}

export function reportSubjectReadmes(paths, details = {}) {
  const out = {};
  out['reports/README.md'] = '# 조사·보고서·학습 자료\n\n주제별 정본과 첨부를 함께 보관합니다. 보고서의 날짜·상태는 현재 제품의 검증 완료를 뜻하지 않습니다.\n\n| 주제 | 내용 |\n| --- | --- |\n' + Object.entries(REPORT_SUBJECTS).map(([key, title]) => `| [${title}](${key}/README.md) | ${key} |`).join('\n') + '\n';
  for (const [subject, title] of Object.entries(REPORT_SUBJECTS)) {
    const documents = paths.filter(path => path.startsWith(`reports/${subject}/`) && path.endsWith('.md') && path !== `reports/${subject}/README.md`).sort();
    const cell = value => String(value || '').replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('[', '').replaceAll(']', '');
    const links = documents.map(path => { const item = details[path] || {}, relative = path.slice(9 + subject.length); return `| [${cell(item.title || relative)}](${relative}) | ${cell(item.id)} | ${cell(item.date)} | ${cell(item.status || '원문 참조')} |`; });
    const groups = [...new Set(paths.filter(path => path.startsWith(`reports/${subject}/`) && path.split('/').length > 3).map(path => path.split('/')[2]))].sort();
    out[`reports/${subject}/README.md`] = `# ${title}\n\n[전체 주제](../README.md)\n\n원문 ID·작성일·검증 상태를 기준으로 읽습니다. 관련 첨부는 각 작업 묶음에 보관합니다.\n\n` + groups.map(group => `[${group}](${group}/)`).join(' · ') + '\n\n' + (links.length ? '| 문서 | ID | 기록 날짜 | 상태 |\n| --- | --- | --- | --- |\n' + links.join('\n') : '관련 조사 기록은 아래 연결 자료에서 확인합니다.') + '\n';
  }
  out['reports/terrain/README.md'] += '\n- [배포 지형 자료](../../terrain/)\n- [시아첸 지형·국경 조사](../borders/reconstruction/siachen/)\n- [지형 렌더링 검증](../development/rendering/)\n';
  out['reports/map-analysis/README.md'] += '\n- [학습 데이터](corpus/)\n- [모델·체크포인트](models/)\n- [조사·평가 기록](reports/)\n';
  out['reports/borders/README.md'] += '\nGIS 생성기의 원자료는 기존 마운트와 보관 색인에 유지됩니다. [보관 색인](../../archive/index.json)을 참조합니다.\n';
  return out;
}
