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
  if (!from.endsWith('.json')) return rewriteReportLinks(text, from, to, mapping);
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
