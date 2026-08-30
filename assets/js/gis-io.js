/* PandoLab GIS I/O
 * QGIS-compatible vector import and GeoPackage export.
 * Heavy GDAL/SQLite assets are loaded only when file I/O is requested.
 */

(() => {
  'use strict';

  const scriptUrl = document.currentScript?.src || new URL('./assets/js/gis-io.js', location.href).href;
  const baseUrl = new URL('./', scriptUrl);
  const gdalBaseUrl = new URL('vendor/gdal/', baseUrl).href;
  const gdalScriptUrl = new URL('vendor/gdal/gdal3.js', baseUrl).href;
  const fflateScriptUrl = new URL('vendor/fflate/fflate.min.js', baseUrl).href;
  const importPlanModuleUrl = new URL('modules/import-plan.js', baseUrl).href;
  const gpkgWorkerUrlObject = new URL('workers/gis-gpkg-worker.js', baseUrl);
  gpkgWorkerUrlObject.searchParams.set('v', '0.30.0-r25');
  const gpkgWorkerUrl = gpkgWorkerUrlObject.href;
  const supportedExtensions = new Set(['gpkg', 'geojson', 'json', 'shp', 'shx', 'dbf', 'prj', 'cpg', 'shz', 'zip', 'kml', 'kmz', 'gml', 'xml', 'fgb', 'qgz', 'qgs']);
  const archiveExtensions = new Set(['qgz', 'shz', 'zip', 'kmz']);
  const gisAdapters = window.PandoLabGisAdapters;
  if (!gisAdapters) throw new Error('GIS 교환 어댑터를 불러오지 못했습니다.');
  const inputLimit = 512 * 1024 * 1024;
  const extractedLimit = 1024 * 1024 * 1024;
  const archiveEntryLimit = 10000;
  const GIS_MANIFEST_SCHEMA_VERSION = 2;
  let gdalPromise = null;
  let gpkgWorker = null;
  let workerSequence = 0;
  const workerPending = new Map();
  let activeSession = null;
  let importPlanModulePromise = null;
  const TERRITORIAL_IMPORT_TARGETS = Object.freeze({
    TERRITORY: 'territory',
    ADMINISTRATIVE: 'administrative',
    REGION: 'region',
  });
  const PARTITION_IMPORT_TARGETS = new Set([TERRITORIAL_IMPORT_TARGETS.TERRITORY, TERRITORIAL_IMPORT_TARGETS.ADMINISTRATIVE]);
  let wizardReturnFocus = null;

  function importPlanModule() {
    importPlanModulePromise ||= import(importPlanModuleUrl);
    return importPlanModulePromise;
  }

  function extension(name) {
    const match = String(name || '').toLowerCase().match(/\.([^./]+)$/);
    return match ? match[1] : '';
  }

  function basename(path) {
    return String(path || '').replace(/\\/g, '/').split('/').pop() || '';
  }

  function withoutExtension(name) {
    return basename(name).replace(/\.[^.]+$/, '');
  }

  function normalizeRelativePath(path) {
    const parts = String(path || '').replace(/\\/g, '/').replace(/^\.\//, '').split('/');
    const normalized = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') normalized.pop();
      else normalized.push(part);
    }
    return normalized.join('/').toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === url);
      if (existing?.dataset.loaded === 'true') { resolve(); return; }
      const script = existing || document.createElement('script');
      if (!existing) {
        script.src = url;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', () => reject(new Error(`GIS 라이브러리를 불러오지 못했습니다: ${basename(url)}`)), { once: true });
    });
  }

  async function getGdal(progress = () => {}) {
    if (!gdalPromise) {
      gdalPromise = (async () => {
        progress('GIS 변환 엔진을 불러오는 중입니다.', 12);
        await loadScript(gdalScriptUrl);
        if (typeof window.initGdalJs !== 'function') throw new Error('GDAL 초기화 함수를 찾을 수 없습니다.');
        progress('좌표계와 파일 드라이버를 준비하는 중입니다.', 28);
        return window.initGdalJs({
          path: gdalBaseUrl,
          useWorker: true,
        });
      })().catch(error => { gdalPromise = null; throw error; });
    }
    return gdalPromise;
  }

  async function getFflate() {
    if (!window.fflate) await loadScript(fflateScriptUrl);
    if (!window.fflate?.unzipSync) throw new Error('압축 파일 처리 엔진을 불러오지 못했습니다.');
    return window.fflate;
  }

  function getGpkgWorker() {
    if (gpkgWorker) return gpkgWorker;
    gpkgWorker = new Worker(gpkgWorkerUrl, { name: 'pandolab-gpkg' });
    gpkgWorker.onmessage = event => {
      const pending = workerPending.get(event.data?.id);
      if (!pending) return;
      workerPending.delete(event.data.id);
      if (event.data.ok) pending.resolve(event.data);
      else pending.reject(new Error(event.data.error || 'GeoPackage 처리에 실패했습니다.'));
    };
    gpkgWorker.onerror = event => {
      for (const pending of workerPending.values()) pending.reject(new Error(event.message || 'GeoPackage Worker 오류'));
      workerPending.clear();
      gpkgWorker.terminate();
      gpkgWorker = null;
    };
    return gpkgWorker;
  }

  function callGpkgWorker(action, buffer, extra = {}) {
    return new Promise((resolve, reject) => {
      const worker = getGpkgWorker();
      const id = ++workerSequence;
      workerPending.set(id, { resolve, reject });
      worker.postMessage({ id, action, buffer, ...extra }, [buffer]);
    });
  }

  async function readAtlasMetadata(file) {
    if (!file || extension(file.name) !== 'gpkg') return null;
    try {
      const buffer = await file.arrayBuffer();
      const result = await callGpkgWorker('read', buffer);
      return result.metadata || null;
    } catch (error) {
      console.debug('PandoLab GeoPackage metadata not found:', error);
      return null;
    }
  }

  function validateArchivePath(path) {
    const normalized = String(path || '').replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
      throw new Error(`안전하지 않은 압축 경로가 포함되어 있습니다: ${path}`);
    }
    return normalized;
  }

  async function unpackArchive(file) {
    const fflate = await getFflate();
    const archiveBytes = new Uint8Array(await file.arrayBuffer());
    let inspectedCount = 0;
    let inspectedBytes = 0;
    const entries = fflate.unzipSync(archiveBytes, {
      filter: entry => {
        validateArchivePath(entry.name);
        inspectedCount += 1;
        inspectedBytes += Number(entry.originalSize || 0);
        if (inspectedCount > archiveEntryLimit) throw new Error(`압축 파일 항목이 ${archiveEntryLimit.toLocaleString()}개를 초과합니다.`);
        if (inspectedBytes > extractedLimit || (file.size > 0 && inspectedBytes > file.size * 100)) throw new Error('압축 해제 크기가 안전 한도를 초과했습니다.');
        return supportedExtensions.has(extension(entry.name)) && !archiveExtensions.has(extension(entry.name));
      },
    });
    const names = Object.keys(entries);
    if (names.length > archiveEntryLimit) throw new Error(`압축 파일 항목이 너무 많습니다 (${names.length.toLocaleString()}개).`);
    let total = 0;
    const files = [];
    let manifest = null;
    for (const rawName of names) {
      const safeName = validateArchivePath(rawName);
      const bytes = entries[rawName];
      total += bytes.byteLength;
      if (total > extractedLimit || (file.size > 0 && total > file.size * 100)) throw new Error('압축 해제 크기가 안전 한도를 초과했습니다.');
      const ext = extension(safeName);
      if (!supportedExtensions.has(ext) || archiveExtensions.has(ext)) continue;
      if (basename(safeName).toLowerCase() === 'manifest.json') {
        try { manifest = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { /* A malformed manifest is ignored; vector layers remain importable. */ }
        continue;
      }
      files.push(new File([bytes], basename(safeName), { type: 'application/octet-stream', lastModified: file.lastModified }));
      files[files.length - 1].__atlasArchivePath = safeName;
    }
    if (manifest?.pandolabExport === true && Number(manifest.schemaVersion) !== GIS_MANIFEST_SCHEMA_VERSION) {
      throw new Error(`지원하지 않는 GIS manifest schemaVersion입니다. 현재 버전: ${GIS_MANIFEST_SCHEMA_VERSION}`);
    }
    files.__pandolabManifest = manifest;
    return files;
  }

  function qgsColorFromSymbol(symbol) {
    if (!symbol) return null;
    const candidates = [
      ...symbol.querySelectorAll('prop[k="color"], prop[k="fill_color"]'),
      ...symbol.querySelectorAll('Option[name="color"], Option[name="fillColor"]'),
    ];
    for (const node of candidates) {
      const raw = node.getAttribute('v') || node.getAttribute('value') || '';
      const parts = raw.split(',').map(Number);
      if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
        return `#${parts.slice(0, 3).map(value => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')).join('')}`;
      }
      if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    }
    return null;
  }

  function parseQgsProject(text, projectName = 'QGIS project') {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('QGS XML이 손상되었거나 올바르지 않습니다.');
    const layers = [];
    for (const mapLayer of xml.querySelectorAll('projectlayers > maplayer, maplayer')) {
      const provider = (mapLayer.querySelector(':scope > provider')?.textContent || '').trim().toLowerCase();
      const datasource = (mapLayer.querySelector(':scope > datasource')?.textContent || '').trim();
      const layerName = (mapLayer.querySelector(':scope > layername')?.textContent || '').trim();
      if (!datasource || (provider && !['ogr', 'gdal'].includes(provider))) continue;
      let sourcePath = datasource.split('|')[0];
      let sourceLayer = datasource.match(/(?:^|\|)layername=([^|]+)/i)?.[1] || '';
      const dbMatch = datasource.match(/dbname=['"]([^'"]+)['"]/i);
      if (dbMatch) sourcePath = dbMatch[1];
      const tableMatch = datasource.match(/table=['"]?([^'"\s(]+)['"]?/i);
      if (!sourceLayer && tableMatch) sourceLayer = tableMatch[1];
      try { sourcePath = decodeURIComponent(sourcePath); } catch (_) {}
      const renderer = mapLayer.querySelector('renderer-v2');
      const style = { type: renderer?.getAttribute('type') || '', field: renderer?.getAttribute('attr') || '', singleColor: null, categories: {} };
      if (renderer) {
        const symbols = new Map();
        renderer.querySelectorAll('symbols > symbol').forEach(symbol => symbols.set(symbol.getAttribute('name') || '', qgsColorFromSymbol(symbol)));
        style.singleColor = symbols.get('0') || qgsColorFromSymbol(renderer.querySelector('symbol'));
        renderer.querySelectorAll('categories > category').forEach(category => {
          const color = symbols.get(category.getAttribute('symbol') || '');
          if (color) style.categories[String(category.getAttribute('value') ?? '')] = color;
        });
      }
      const labelField = mapLayer.querySelector('customproperties > property[key="labeling/fieldName"]')?.getAttribute('value')
        || mapLayer.querySelector('labeling settings text-style')?.getAttribute('fieldName')
        || '';
      layers.push({ projectName, layerName, sourcePath, sourceFile: basename(sourcePath), sourceLayer, provider, style, labelField });
    }
    return layers;
  }

  function qgsReferenceReport(qgsLayers, files) {
    const exactPaths = new Map();
    const lowerNames = new Map();
    for (const file of files) {
      const name = file.name.toLowerCase();
      if (!lowerNames.has(name)) lowerNames.set(name, []);
      lowerNames.get(name).push(file);
      const relativePath = normalizeRelativePath(file.__atlasArchivePath || file.webkitRelativePath || file.name);
      if (!exactPaths.has(relativePath)) exactPaths.set(relativePath, []);
      exactPaths.get(relativePath).push(file);
    }
    const missing = [];
    const ambiguous = [];
    for (const layer of qgsLayers) {
      if (!layer.sourceFile || /^(https?|postgres|wms|wfs|mssql|oracle):/i.test(layer.sourcePath)) {
        missing.push(`${layer.layerName || layer.sourceLayer || '이름 없는 레이어'} · 원격/DB 데이터 소스`);
        continue;
      }
      const exact = exactPaths.get(normalizeRelativePath(layer.sourcePath)) || [];
      const candidates = exact.length ? exact : (lowerNames.get(layer.sourceFile.toLowerCase()) || []);
      if (!candidates.length) missing.push(`${layer.layerName || layer.sourceLayer || '이름 없는 레이어'} · ${layer.sourceFile}`);
      else if (candidates.length > 1) ambiguous.push(`${layer.layerName || layer.sourceLayer || '이름 없는 레이어'} · ${layer.sourceFile}`);
    }
    return { missing, ambiguous };
  }

  async function prepareFiles(inputFiles, progress) {
    const originals = [...inputFiles];
    const selectedBytes = originals.reduce((sum, file) => sum + file.size, 0);
    if (!originals.length) throw new Error('가져올 파일을 선택하세요.');
    if (selectedBytes > inputLimit) throw new Error('선택한 파일의 전체 크기가 512MB를 초과합니다.');
    const dataFiles = [];
    const qgsTexts = [];
    let manifest = null;
    for (let i = 0; i < originals.length; i += 1) {
      const file = originals[i];
      const ext = extension(file.name);
      progress(`파일을 확인하는 중입니다. ${i + 1}/${originals.length}`, 4 + Math.round((i / originals.length) * 10));
      if (!supportedExtensions.has(ext)) continue;
      if (archiveExtensions.has(ext)) {
        const unpacked = await unpackArchive(file);
        manifest ||= unpacked.__pandolabManifest || null;
        for (const entry of unpacked) {
          if (extension(entry.name) === 'qgs') qgsTexts.push({ name: entry.name, text: await entry.text() });
          else dataFiles.push(entry);
        }
      } else if (ext === 'qgs') {
        qgsTexts.push({ name: file.name, text: await file.text() });
      } else {
        dataFiles.push(file);
      }
    }
    const driverPriority = { shp: 0, gpkg: 0, geojson: 0, json: 0, kml: 0, gml: 0, xml: 0, fgb: 0, shx: 10, dbf: 11, prj: 12, cpg: 13 };
    dataFiles.sort((a, b) => (driverPriority[extension(a.name)] ?? 5) - (driverPriority[extension(b.name)] ?? 5));
    const qgsLayers = qgsTexts.flatMap(project => parseQgsProject(project.text, project.name));
    const report = qgsReferenceReport(qgsLayers, dataFiles);
    if (!dataFiles.length) throw new Error(qgsLayers.length ? `QGIS 프로젝트가 참조하는 경계 파일을 함께 선택하세요.\n${report.missing.slice(0, 4).join('\n')}` : '지원되는 벡터 데이터 파일이 없습니다.');
    return { originals, dataFiles, qgsLayers, report, manifest };
  }

  function layerGeometryType(layer) {
    const values = [layer?.geometryType, ...(layer?.geometryFields || []).map(field => field.type)].filter(Boolean);
    return values.join(', ') || '알 수 없음';
  }

  function layerCrs(layer, driverName) {
    const geometryField = layer?.geometryFields?.[0];
    const coordinateSystem = geometryField?.coordinateSystem || layer?.coordinateSystem || null;
    const wkt = coordinateSystem?.wkt || coordinateSystem?.projjson?.name || '';
    const id = coordinateSystem?.projjson?.id;
    if (id?.authority && id?.code) return { hasCrs: true, label: `${id.authority}:${id.code}`, source: `${id.authority}:${id.code}` };
    const epsg = String(wkt).match(/(?:AUTHORITY|ID)\s*\[\s*["']EPSG["']\s*,\s*["']?(\d+)/i)?.[1];
    if (epsg) return { hasCrs: true, label: `EPSG:${epsg}`, source: `EPSG:${epsg}` };
    if (wkt) return { hasCrs: true, label: coordinateSystem?.projjson?.name || 'WKT 좌표계', source: null };
    if (/GeoJSON|KML/i.test(driverName || '')) return { hasCrs: true, label: 'EPSG:4326', source: 'EPSG:4326' };
    return { hasCrs: false, label: '좌표계 없음', source: null };
  }

  function layerFields(layer) {
    return (layer?.fields || []).map(field => typeof field === 'string' ? field : field.name).filter(Boolean);
  }

  function layerFieldDefinitions(layer) {
    return (layer?.fields || []).map(field => typeof field === 'string'
      ? { name: field, type: 'String' }
      : { name: field.name, type: field.type || 'String', subtype: field.subType || null, width: field.width ?? null, precision: field.precision ?? null })
      .filter(field => field.name);
  }

  function layerFieldExamples(layer) {
    const sample = layer?.features?.find(feature => feature?.properties)?.properties
      || layer?.sampleFeature?.properties
      || layer?.exampleFeature?.properties
      || {};
    return Object.fromEntries(Object.entries(sample).filter(([, value]) => value == null || ['string', 'number', 'boolean'].includes(typeof value)));
  }

  async function geoJsonFieldProfiles(files) {
    const profiles = new Map();
    for (const file of files || []) {
      if (!['geojson', 'json'].includes(extension(file.name)) || Number(file.size || 0) > 20 * 1024 * 1024) continue;
      try {
        const parsed = JSON.parse(await file.text());
        const features = parsed?.type === 'FeatureCollection' ? parsed.features || [] : parsed?.type === 'Feature' ? [parsed] : [];
        const feature = features.find(item => item?.properties);
        if (!feature?.properties) continue;
        const values = Object.fromEntries(Object.entries(feature.properties).filter(([, value]) => value == null || ['string', 'number', 'boolean'].includes(typeof value)));
        const fieldNames = new Set(features.flatMap(item => Object.keys(item?.properties || {})));
        const fieldProfiles = {};
        for (const fieldName of fieldNames) {
          const distinct = new Set();
          let populatedCount = 0;
          for (const item of features) {
            const value = item?.properties?.[fieldName];
            if (value == null || value === '' || !['string', 'number', 'boolean'].includes(typeof value)) continue;
            populatedCount += 1;
            distinct.add(String(value).trim());
            if (distinct.size > 1) break;
          }
          fieldProfiles[fieldName] = {
            values: [...distinct],
            complete: populatedCount === features.length,
          };
        }
        const profile = { examples: values, fieldProfiles };
        profiles.set(basename(file.name).toLowerCase(), profile);
        profiles.set(withoutExtension(file.name).toLowerCase(), profile);
      } catch (_) { /* GDAL reports malformed source files through the normal inspection path. */ }
    }
    return profiles;
  }

  function styleForLayer(qgsLayers, layerName, datasetPath) {
    const base = basename(datasetPath).toLowerCase();
    return qgsLayers.find(layer => layer.sourceLayer && layer.sourceLayer === layerName)
      || qgsLayers.find(layer => layer.layerName && layer.layerName === layerName)
      || qgsLayers.find(layer => layer.sourceFile?.toLowerCase() === base)
      || null;
  }

  async function inspectFiles(inputFiles, progress) {
    await closeActiveSession();
    const prepared = await prepareFiles(inputFiles, progress);
    const geoJsonProfiles = await geoJsonFieldProfiles(prepared.dataFiles);
    const gdal = await getGdal(progress);
    progress('벡터 레이어를 검사하는 중입니다.', 42);
    const opened = await gdal.open(prepared.dataFiles);
    if (!opened.datasets?.length) throw new Error(`벡터 파일을 열 수 없습니다.${opened.errors?.length ? ` ${opened.errors.map(error => error.message || error).join(' · ')}` : ''}`);
    const descriptors = [];
    for (let datasetIndex = 0; datasetIndex < opened.datasets.length; datasetIndex += 1) {
      const dataset = opened.datasets[datasetIndex];
      let info = dataset.info;
      try { info = await gdal.ogrinfo(dataset, ['-so', '-al']); }
      catch (error) { console.warn('PandoLab layer inspection failed', error); }
      const layers = info?.layers || dataset.info?.layers || [];
      for (const layer of layers) {
        if (Number(layer.featureCount) === 0) continue;
        const geometryType = layerGeometryType(layer);
        const hasGeometryField = Array.isArray(layer?.geometryFields) && layer.geometryFields.length > 0;
        if (!hasGeometryField && /none|unknown|알 수 없음/i.test(geometryType)) continue;
        const crs = layerCrs(layer, info?.driverShortName || dataset.info?.driverName || '');
        const qgs = styleForLayer(prepared.qgsLayers, layer.name, dataset.path || dataset.info?.dsName || '');
        const geoJsonProfile = geoJsonProfiles.get(basename(dataset.path || dataset.info?.dsName || '').toLowerCase())
          || geoJsonProfiles.get(withoutExtension(dataset.path || dataset.info?.dsName || '').toLowerCase());
        descriptors.push({
          datasetIndex,
          layerName: layer.name,
          featureCount: Number(layer.featureCount || 0),
          geometryType,
          fields: layerFields(layer),
          fieldDefinitions: layerFieldDefinitions(layer),
          fieldExamples: {
            ...(geoJsonProfile?.examples || {}),
            ...layerFieldExamples(layer),
          },
          fieldProfiles: geoJsonProfile?.fieldProfiles || {},
          crs,
          driverName: info?.driverLongName || info?.driverShortName || dataset.info?.driverName || 'OGR',
          datasetPath: dataset.path || dataset.info?.dsName || '',
          qgsStyle: qgs?.style || null,
          qgsLabelField: qgs?.labelField || '',
        });
      }
    }
    if (!descriptors.length) throw new Error('가져올 수 있는 벡터 레이어를 찾지 못했습니다.');
    const projectFile = prepared.originals.find(file => extension(file.name) === 'gpkg');
    const projectMetadata = projectFile ? await readAtlasMetadata(projectFile) : null;
    activeSession = { gdal, datasets: opened.datasets, descriptors, prepared, projectMetadata };
    progress(`벡터 레이어 ${descriptors.length}개 확인됨`, 100);
    return activeSession;
  }

  async function closeActiveSession() {
    if (!activeSession) return;
    const { gdal, datasets } = activeSession;
    activeSession = null;
    await Promise.allSettled((datasets || []).map(dataset => gdal.close(dataset)));
  }

  function autoField(fields, candidates) {
    const lower = new Map(fields.map(field => [field.toLowerCase(), field]));
    for (const candidate of candidates) if (lower.has(candidate.toLowerCase())) return lower.get(candidate.toLowerCase());
    return '';
  }

  function fieldExampleText(field, fieldExamples = {}) {
    const value = fieldExamples?.[field];
    if (value == null || value === '') return '예시 없음';
    return String(value).slice(0, 48);
  }

  function populateFieldSelect(select, fields, { includeFid = false, includeStyle = false, selected = '', roleLabel = '속성', fieldExamples = {} } = {}) {
    select.replaceChildren();
    if (includeFid) select.add(new Option('원본 FID', '__fid__'));
    else select.add(new Option('사용 안 함', ''));
    if (includeStyle) select.add(new Option('QGIS 기본 스타일', '__qgis_style__'));
    fields.forEach(field => {
      const fieldName = String(field);
      select.add(new Option(`${roleLabel} — ${fieldExampleText(fieldName, fieldExamples)}`, fieldName));
    });
    select.value = selected || (includeFid ? '__fid__' : '');
  }

  function updateWizardFields(descriptor) {
    const fields = descriptor.fields || [];
    const fieldOptions = { fieldExamples: descriptor.fieldExamples || {} };
    populateFieldSelect(document.getElementById('gisIdField'), fields, { ...fieldOptions, roleLabel: 'ID', includeFid: true, selected: autoField(fields, ['pandolab_id', 'editor_id', 'ADM0_A3', 'ISO_A3', 'id']) || '__fid__' });
    populateFieldSelect(document.getElementById('gisNameField'), fields, { ...fieldOptions, roleLabel: '이름', selected: autoField(fields, ['pandolab_name', 'NAME_KO', 'name_ko', 'NAME', 'name', descriptor.qgsLabelField]) });
    populateFieldSelect(document.getElementById('gisColorField'), fields, { ...fieldOptions, roleLabel: '색상', includeStyle: true, selected: descriptor.qgsStyle ? '__qgis_style__' : autoField(fields, ['pandolab_color', 'editorColor', 'color', 'fill']) });
    populateFieldSelect(document.getElementById('gisCountryField'), fields, { ...fieldOptions, roleLabel: '소속 국가', selected: autoField(fields, ['sovereign_id', 'country_id', 'countryId', 'iso_a3', 'ISO_A3', 'ADM0_A3', 'country']) });
    populateFieldSelect(document.getElementById('gisParentField'), fields, { ...fieldOptions, roleLabel: '상위 영역', selected: autoField(fields, ['parent_id', 'parent']) });
    populateFieldSelect(document.getElementById('gisLevelField'), fields, { ...fieldOptions, roleLabel: '행정 단계', selected: autoField(fields, ['admin_level', 'level', 'adm_level']) });
    const crsInput = document.getElementById('gisCrsInput');
    crsInput.value = descriptor.crs.source || '';
    crsInput.classList.toggle('hidden', descriptor.crs.hasCrs);
    crsInput.disabled = descriptor.crs.hasCrs;
    crsInput.required = !descriptor.crs.hasCrs;
    document.getElementById('gisCrsSummary').textContent = descriptor.crs.hasCrs ? `${descriptor.crs.label} · 자동 감지` : '좌표계를 확인할 수 없습니다. EPSG 코드를 입력하세요.';
    const dimensionNote = /(?:^|\s)(?:Z|M|ZM)(?:\s|$)/i.test(descriptor.geometryType) ? ' · Z/M은 XY로 편집' : '';
    document.getElementById('gisLayerDetails').textContent = `${descriptor.featureCount.toLocaleString()}개 · ${descriptor.geometryType} · ${descriptor.crs.label} · ${descriptor.driverName}${dimensionNote}`;
    updateTargetFields();
  }

  function suggestedTarget(descriptor, manifest = null) {
    const manifestLayer = (manifest?.layers || []).find(layer => [layer.file, layer.name].filter(Boolean).some(value => withoutExtension(value).toLowerCase() === withoutExtension(descriptor?.datasetPath || descriptor?.layerName).toLowerCase()));
    if (manifestLayer?.targetType) return String(manifestLayer.targetType);
    const hint = `${descriptor?.layerName || ''} ${descriptor?.geometryType || ''}`.toLowerCase();
    if (/country|countries|admin[_ ]?0|국가/.test(hint) && /polygon|surface/.test(hint)) return 'country';
    if (/admin|administrative|행정/.test(hint) && /polygon|surface/.test(hint)) return 'administrative';
    if (/territor|권역/.test(hint) && /polygon|surface/.test(hint)) return 'territory';
    if (/region|province|지방|지역/.test(hint) && /polygon|surface/.test(hint)) return 'region';
    return 'drawing';
  }

  const IMPORT_STEP_LABELS = Object.freeze(['파일 확인', '가져올 내용', '속성 연결', '적용 결과', '최종 확인']);
  let importMobileStep = 0;
  let importSourceKind = 'vector';
  let importStepRoute = [0, 1, 2, 3, 4];
  let wizardOptions = {};

  function updateImportFinalSummary() {
    const layer = document.getElementById('gisLayerSelect')?.selectedOptions?.[0]?.textContent || '자동 선택 레이어';
    const target = document.getElementById('gisTargetType')?.selectedOptions?.[0]?.textContent || '국가';
    const distribution = document.getElementById('gisDistributionType')?.selectedOptions?.[0]?.textContent || '';
    const country = document.getElementById('gisTargetCountry')?.selectedOptions?.[0]?.textContent || '';
    const mode = document.getElementById('gisOpenMode')?.value || 'merge';
    const summary = document.querySelector('#gisFinalSummary p');
    if (!summary) return;
    if (importSourceKind === 'project') {
      const warning = wizardOptions.hasUnsavedChanges ? ' 파일에 저장하지 않은 현재 변경 사항은 사라집니다.' : '';
      summary.textContent = `PandoLab 프로젝트를 열어 현재 작업공간을 교체합니다.${warning}`;
    } else if (PARTITION_IMPORT_TARGETS.has(document.getElementById('gisTargetType')?.value)) {
      summary.textContent = `${layer} 전체를 ${country || '선택한 국가'} 소속 ${target}(으)로 가져오고 필요한 영토를 이전합니다.`;
    } else {
      summary.textContent = `${layer}를 ${target}${distribution && target === '분포' ? ` · ${distribution}` : ''}(으)로 ${mode === 'replace' ? '새 프로젝트에서 엽니다' : '현재 프로젝트에 추가합니다'}.`;
    }
  }

  function setImportMobileStep(step, { focus = false } = {}) {
    const requested = Number(step) || 0;
    importMobileStep = importStepRoute.includes(requested) ? requested : importStepRoute[0];
    for (const element of document.querySelectorAll('[data-gis-step]')) {
      element.dataset.gisActive = String(Number(element.dataset.gisStep) === importMobileStep);
    }
    const indicator = document.getElementById('gisStepIndicator');
    const routeIndex = importStepRoute.indexOf(importMobileStep);
    const label = importSourceKind === 'project' && importMobileStep === 4 ? '열기 확인' : IMPORT_STEP_LABELS[importMobileStep];
    if (indicator) indicator.textContent = `${routeIndex + 1}/${importStepRoute.length} · ${label}`;
    const back = document.getElementById('gisImportBackBtn');
    const next = document.getElementById('gisImportNextBtn');
    const confirm = document.getElementById('gisImportConfirmBtn');
    if (back) back.disabled = routeIndex <= 0;
    const finalStep = routeIndex === importStepRoute.length - 1;
    next?.classList.toggle('hidden', finalStep);
    confirm?.classList.toggle('hidden', !finalStep);
    if (finalStep) updateImportFinalSummary();
    if (focus) {
      requestAnimationFrame(() => document.querySelector(`[data-gis-step="${importMobileStep}"][data-gis-active="true"] :is(select, input, button, summary), [data-gis-step="${importMobileStep}"][data-gis-active="true"]:is(select, input, button, summary)`)?.focus());
    }
  }

  function populateTargetCountries() {
    const select = document.getElementById('gisTargetCountry');
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option('소속 국가를 선택하세요', ''));
    for (const country of wizardOptions.countryOptions || []) select.add(new Option(country.name || country.id, country.id));
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }

  function populateParentUnits() {
    const select = document.getElementById('gisParentUnit');
    if (!select) return;
    const selected = select.value;
    const ownerId = document.getElementById('gisTargetCountry')?.value || '';
    select.replaceChildren(new Option('국가 직속', ''));
    for (const unit of (wizardOptions.parentOptions || []).filter(item => String(item.countryId) === String(ownerId))) {
      select.add(new Option(`${unit.name}${unit.type === 'administrative' ? ` · ${unit.level || 1}단계` : ' · 권역'}`, unit.id));
    }
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }

  function updateTargetFields() {
    const targetSelect = document.getElementById('gisTargetType');
    if (importSourceKind === 'project' && targetSelect) targetSelect.value = 'country';
    const target = targetSelect?.value || 'country';
    const distribution = target === 'distribution';
    const territorial = PARTITION_IMPORT_TARGETS.has(target);
    const useCountryField = document.getElementById('gisUseCountryField')?.checked === true;
    const descriptor = activeSession?.descriptors?.[Number(document.getElementById('gisLayerSelect')?.value) || 0];
    const countrySelect = document.getElementById('gisTargetCountry');
    const countryField = document.getElementById('gisCountryField')?.value || '';
    const countryProfile = descriptor?.fieldProfiles?.[countryField];
    if (territorial && !countrySelect?.value && countryProfile?.complete && countryProfile.values?.length === 1) {
      const wanted = String(countryProfile.values[0] || '').toLocaleLowerCase('ko');
      const recommendation = (wizardOptions.countryOptions || []).find(country => [country.id, country.name]
        .some(value => String(value || '').toLocaleLowerCase('ko') === wanted));
      if (recommendation) countrySelect.value = String(recommendation.id);
    }
    document.getElementById('gisDistributionTypeRow')?.classList.toggle('hidden', !distribution);
    document.getElementById('gisTargetCountryRow')?.classList.toggle('hidden', !territorial);
    document.getElementById('gisParentUnitRow')?.classList.toggle('hidden', target !== 'administrative');
    document.getElementById('gisUseCountryFieldRow')?.classList.toggle('hidden', !territorial);
    document.getElementById('gisCountryFieldRow')?.classList.toggle('hidden', !territorial || !useCountryField);
    document.getElementById('gisParentFieldRow')?.classList.toggle('hidden', target !== 'administrative' || !useCountryField);
    document.getElementById('gisLevelFieldRow')?.classList.toggle('hidden', target !== 'administrative');
    populateParentUnits();
    const modeSelect = document.getElementById('gisOpenMode');
    const modeRow = document.getElementById('gisOpenModeRow');
    if (importSourceKind === 'project') modeSelect.value = 'replace';
    else if (target !== 'country') modeSelect.value = 'merge';
    for (const candidate of document.querySelectorAll('[data-gis-open-mode]')) {
      const active = candidate.dataset.gisOpenMode === modeSelect.value;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-checked', String(active));
    }
    modeRow?.classList.toggle('hidden', importSourceKind === 'project' || target !== 'country');
    const fixedModeNote = document.getElementById('gisFixedOpenModeNote');
    fixedModeNote?.classList.toggle('hidden', importSourceKind !== 'project' && target === 'country');
    const fixedModeTitle = fixedModeNote?.querySelector('strong');
    const fixedModeBody = fixedModeNote?.querySelector('p');
    if (fixedModeTitle) fixedModeTitle.textContent = importSourceKind === 'project' ? '프로젝트 열기' : '현재 지도에 추가';
    if (fixedModeBody) fixedModeBody.textContent = importSourceKind === 'project'
      ? 'PandoLab 프로젝트 데이터와 내부 속성을 그대로 열어 현재 작업공간을 교체합니다.'
      : '선택한 데이터를 현재 프로젝트에 추가하며 기존 프로젝트를 교체하지 않습니다.';
    document.getElementById('gisMergeStrategyRow')?.classList.toggle('hidden', importSourceKind === 'project' || target !== 'country' || modeSelect.value !== 'merge');
    const withExample = (label, field, fallback) => {
      const value = field && field !== '__fid__' && field !== '__qgis_style__' ? descriptor?.fieldExamples?.[field] : undefined;
      const example = value == null || value === '' ? '' : ` (예: ${String(value).slice(0, 48)})`;
      return `${label}: ${field || fallback}${example}`;
    };
    const name = document.getElementById('gisNameField')?.value || '';
    const id = document.getElementById('gisIdField')?.value || '';
    const country = document.getElementById('gisCountryField')?.value || '';
    const parts = [withExample('이름', name, '자동 이름'), withExample('ID', id, '자동 ID')];
    if (territorial) parts.push(useCountryField ? withExample('객체별 소속 국가', country, '공통 소속 국가 사용') : '소속 국가: 위에서 선택한 공통 국가');
    document.getElementById('gisMappingSummary').textContent = parts.join(' · ');
    const confirm = document.getElementById('gisImportConfirmBtn');
    if (confirm) confirm.textContent = importSourceKind === 'project'
      ? '프로젝트 열기'
      : territorial ? '영토 이전 후 가져오기' : modeSelect.value === 'replace' ? '새 프로젝트로 열기' : '현재 지도에 추가';
    updateImportFinalSummary();
  }

  function clearWizardError() {
    const error = document.getElementById('gisImportError');
    if (!error) return;
    error.textContent = '';
    error.classList.add('hidden');
  }

  function showWizardError(message) {
    const error = document.getElementById('gisImportError');
    if (!error) return;
    error.textContent = message;
    error.classList.remove('hidden');
  }

  function setWizardProgress(message, percent = null) {
    const status = document.getElementById('gisImportStatus');
    const bar = document.getElementById('gisImportProgressBar');
    if (status) status.textContent = message;
    status?.classList.remove('error');
    document.getElementById('gisImportProgress')?.classList.remove('hidden');
    if (bar && percent != null) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function openWizardModal() {
    const fileInput = document.getElementById('gisFileInput');
    const explicitReturnTarget = fileInput?.dataset.returnFocusId ? document.getElementById(fileInput.dataset.returnFocusId) : null;
    if (fileInput) delete fileInput.dataset.returnFocusId;
    const active = document.activeElement;
    if (explicitReturnTarget) wizardReturnFocus = explicitReturnTarget;
    else if (active instanceof HTMLElement && active !== document.body && active.id !== 'gisFileInput') wizardReturnFocus = active;
    document.getElementById('gisImportModal')?.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeWizardModal() {
    document.getElementById('gisImportModal')?.classList.add('hidden');
    document.body.classList.remove('modal-open');
    const returnTarget = wizardReturnFocus?.isConnected ? wizardReturnFocus : document.getElementById('openGisBtn');
    wizardReturnFocus = null;
    if (returnTarget?.id && returnTarget.closest('.top-actions')) {
      const restoreEvent = new CustomEvent('pandolab:restore-file-menu-focus', {
        bubbles: false,
        cancelable: true,
        detail: { targetId: returnTarget.id },
      });
      if (!document.dispatchEvent(restoreEvent)) return;
    }
    returnTarget?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (returnTarget?.isConnected && document.activeElement !== returnTarget) returnTarget.focus({ preventScroll: true });
    });
  }

  async function sha256File(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function applyQgsColor(style, properties) {
    if (!style) return '';
    if (style.field && Object.prototype.hasOwnProperty.call(properties, style.field)) {
      const value = String(properties[style.field] ?? '');
      if (style.categories?.[value]) return style.categories[value];
    }
    return style.singleColor || '';
  }

  function geometryAsMultiPolygon(geometry) {
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
    if (geometry?.type === 'Polygon') return [geometry.coordinates];
    return null;
  }

  function validateMultiPolygon(coordinates) {
    if (!Array.isArray(coordinates) || !coordinates.length) return false;
    for (const polygon of coordinates) {
      if (!Array.isArray(polygon) || !polygon.length) return false;
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) return false;
        const first = ring[0], last = ring[ring.length - 1];
        if (!Array.isArray(first) || !Array.isArray(last) || first[0] !== last[0] || first[1] !== last[1]) return false;
        for (const point of ring) if (!Array.isArray(point) || !Number.isFinite(+point[0]) || !Number.isFinite(+point[1]) || +point[0] < -180.000001 || +point[0] > 180.000001 || +point[1] < -90.000001 || +point[1] > 90.000001) return false;
      }
    }
    return true;
  }

  function normalizeCountryFeatures(featureCollection, descriptor, mapping) {
    const groups = new Map();
    const invalid = [];
    for (let index = 0; index < (featureCollection.features || []).length; index += 1) {
      const raw = featureCollection.features[index];
      const coordinates = geometryAsMultiPolygon(raw.geometry);
      if (!validateMultiPolygon(coordinates)) { invalid.push(raw.id ?? index); continue; }
      let properties = { ...(raw.properties || {}) };
      if (properties.pandolab_source_properties) {
        try { properties = { ...JSON.parse(properties.pandolab_source_properties), ...properties }; } catch (_) {}
      }
      const rawId = mapping.idField === '__fid__' ? (raw.id ?? index + 1) : properties[mapping.idField];
      const sourceId = String(rawId ?? '').trim();
      if (!sourceId) throw new Error(`국가 원본 ID가 비어 있는 객체가 있습니다: ${raw.id ?? index + 1}`);
      const name = String(mapping.nameField ? (properties[mapping.nameField] ?? '') : '').trim() || `국가 ${sourceId}`;
      let color = '';
      if (mapping.colorField === '__qgis_style__') color = applyQgsColor(descriptor.qgsStyle, properties);
      else if (mapping.colorField) color = String(properties[mapping.colorField] || '');
      if (!/^#[0-9a-f]{6}$/i.test(color)) color = '#63758a';
      const feature = {
        type: 'Feature', id: sourceId,
        properties: {
          ...properties,
          editor_id: sourceId,
          iso_a3: properties.iso_a3 || properties.ISO_A3 || properties.ADM0_A3 || sourceId,
          editor_original_name: name,
          editor_name: name,
          editor_color: color,
          editor_custom: true,
          metadata: { ...(properties.metadata && typeof properties.metadata === 'object' ? properties.metadata : {}), sourceId },
        },
        geometry: { type: 'MultiPolygon', coordinates },
      };
      if (!groups.has(sourceId)) groups.set(sourceId, []);
      groups.get(sourceId).push(feature);
    }
    if (invalid.length) throw new Error(`유효하지 않은 Polygon/MultiPolygon 객체가 있습니다: ${invalid.slice(0, 8).join(', ')}${invalid.length > 8 ? '…' : ''}`);
    const duplicates = [...groups.entries()].filter(([, values]) => values.length > 1);
    if (duplicates.length && !mapping.groupDuplicates) throw new Error(`중복 국가 ID가 있습니다: ${duplicates.slice(0, 8).map(([id]) => id).join(', ')}`);
    const features = [];
    for (const [sourceId, values] of groups) {
      const first = values[0];
      if (values.length > 1) {
        first.geometry.coordinates = values.flatMap(value => value.geometry.coordinates);
        first.properties.pandolab_source_rows = JSON.stringify(values.map(value => value.properties));
      }
      const projectId = globalThis.crypto.randomUUID();
      first.id = projectId;
      first.properties.editor_id = projectId;
      first.properties.metadata = { ...(first.properties.metadata || {}), sourceId };
      features.push(first);
    }
    return { type: 'FeatureCollection', features };
  }

  async function layerAsGeoJson(gdal, dataset, layerName, outputTag) {
    const output = await gdal.ogr2ogr(dataset, ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-dim', 'XY', layerName], `pandolab_${outputTag}_${Date.now()}`);
    return JSON.parse(new TextDecoder().decode(await gdal.getFileBytes(output)));
  }

  async function readAtlasVectorState(gdal, dataset, baseState = {}) {
    const layerNames = new Set((dataset.info?.layers || []).map(layer => layer.name));
    const hasPlaces = layerNames.has('places');
    const drawingLayerNames = ['drawings_point', 'drawings_line', 'drawings_polygon'].filter(name => layerNames.has(name));
    const territorialLayerNames = Object.keys(gisAdapters.TERRITORIAL_TYPES_BY_TABLE).filter(name => layerNames.has(name));
    const distributionLayerNames = Object.keys(gisAdapters.DISTRIBUTION_TYPES_BY_TABLE).filter(name => layerNames.has(name));
    const state = {};
    if (hasPlaces) {
      const collection = await layerAsGeoJson(gdal, dataset, 'places', 'places');
      state.labels = (collection.features || []).filter(feature => feature.geometry?.type === 'Point').map((feature, index) => ({
        id: String(feature.properties?.pandolab_id || feature.id || `place_${index + 1}`),
        name: String(feature.properties?.name || ''),
        kind: String(feature.properties?.kind || 'custom'),
        countryId: String(feature.properties?.country_id || ''),
        notes: String(feature.properties?.notes || ''),
        coordinates: feature.geometry.coordinates.slice(0, 2),
      }));
    }
    if (drawingLayerNames.length) {
      state.drawings = [];
      for (const layerName of drawingLayerNames) {
        const collection = await layerAsGeoJson(gdal, dataset, layerName, layerName);
        for (let index = 0; index < (collection.features || []).length; index += 1) {
          const feature = collection.features[index];
          const basic = feature.properties || {};
          let properties = {};
          try { properties = basic.properties_json ? JSON.parse(basic.properties_json) : {}; } catch (_) {}
          state.drawings.push({
            type: 'Feature',
            id: String(basic.pandolab_id || feature.id || `${layerName}_${index + 1}`),
            properties: {
              ...properties,
              name: basic.name ?? properties.name ?? '',
              category: basic.category ?? properties.category ?? 'custom',
              pandolab_role: basic.pandolab_role ?? properties.pandolab_role ?? '',
              pandolab_owner_id: basic.pandolab_owner_id ?? properties.pandolab_owner_id ?? '',
              pandolab_parent_id: basic.pandolab_parent_id ?? properties.pandolab_parent_id ?? '',
              pandolab_topology_group: basic.pandolab_topology_group ?? properties.pandolab_topology_group ?? '',
              pandolab_land_binding: basic.pandolab_land_binding ?? properties.pandolab_land_binding ?? '',
              editorColor: basic.color ?? properties.editorColor ?? properties.color ?? '#8c68d8',
              notes: basic.notes ?? properties.notes ?? '',
            },
            geometry: feature.geometry,
          });
        }
      }
    }
    if (territorialLayerNames.length) {
      state.territorialUnits = [];
      const unitIds = new Set();
      for (const layerName of territorialLayerNames) {
        const collection = await layerAsGeoJson(gdal, dataset, layerName, layerName);
        for (let index = 0; index < (collection.features || []).length; index += 1) {
          const unit = gisAdapters.importTerritorialFeature(collection.features[index], layerName, index);
          if (!unit) continue;
          if (unitIds.has(unit.id)) throw new Error(`영역 ID 충돌: ${unit.id}`);
          unitIds.add(unit.id);
          state.territorialUnits.push(unit);
        }
      }
    }
    if (distributionLayerNames.length) {
      const collections = [];
      for (const layerName of distributionLayerNames) {
        const collection = await layerAsGeoJson(gdal, dataset, layerName, layerName);
        collections.push({ tableName: layerName, features: collection.features || [] });
      }
      const imported = gisAdapters.mergeDistributionFeatures(collections, baseState.distributionLayers || []);
      state.distributionLayers = imported.layers;
      state.distributionEntries = imported.entries;
    }
    return state;
  }

  async function convertSelectedLayer(descriptor, mapping, progress) {
    if (!activeSession) throw new Error('GIS 가져오기 세션이 종료되었습니다.');
    if (/curvepolygon|circularstring|compoundcurve/i.test(descriptor.geometryType)) throw new Error('곡선 표면은 자동 변형하지 않습니다. QGIS에서 Polygon/MultiPolygon으로 변환하세요.');
    const { gdal, datasets, prepared } = activeSession;
    const dataset = datasets[descriptor.datasetIndex];
    const options = ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-dim', 'XY', '-fieldTypeToString', 'Integer64,Integer64List', '-lco', 'RFC7946=YES'];
    if (mapping.targetType === 'country') options.push('-nlt', 'PROMOTE_TO_MULTI');
    if (!descriptor.crs.hasCrs) {
      if (!/^EPSG:\d+$/i.test(mapping.sourceCrs || '')) throw new Error('좌표계가 없는 레이어에는 EPSG 코드를 입력하세요.');
      options.push('-s_srs', mapping.sourceCrs.toUpperCase());
    }
    options.push(descriptor.layerName);
    progress('선택 레이어를 EPSG:4326으로 변환하는 중입니다.', 55);
    const output = await gdal.ogr2ogr(dataset, options, `pandolab_import_${Date.now()}`);
    const bytes = await gdal.getFileBytes(output);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    const countriesData = mapping.targetType === 'country' ? normalizeCountryFeatures(parsed, descriptor, mapping) : null;
    progress('원본 속성과 프로젝트 정보를 확인하는 중입니다.', 78);
    const sourceFile = prepared.dataFiles.find(file => file.name.toLowerCase() === basename(descriptor.datasetPath).toLowerCase())
      || prepared.dataFiles.find(file => withoutExtension(file.name).toLowerCase() === withoutExtension(descriptor.datasetPath).toLowerCase());
    const atlasMetadata = activeSession.projectMetadata || (sourceFile && extension(sourceFile.name) === 'gpkg' ? await readAtlasMetadata(sourceFile) : null);
    if (atlasMetadata?.projectState) {
      const vectorState = await readAtlasVectorState(gdal, dataset, atlasMetadata.projectState);
      atlasMetadata.projectState = { ...atlasMetadata.projectState, ...vectorState };
    }
    const fileHashes = [];
    for (const file of prepared.originals) fileHashes.push({ name: file.name, size: file.size, sha256: await sha256File(file) });
    progress('가져오기 미리보기를 준비했습니다.', 100);
    const { normalizeImportPlan } = await importPlanModule();
    return {
      collection: parsed,
      countriesData,
      atlasMetadata,
      importPlan: normalizeImportPlan({
        sourceKind: atlasMetadata?.projectState ? 'project' : mapping.sourceKind,
        sourceFormat: extension(sourceFile?.name || descriptor.datasetPath),
        layerCandidates: activeSession.descriptors.map(item => ({ name: item.layerName, geometryType: item.geometryType, featureCount: item.featureCount })),
        selectedLayer: descriptor.layerName,
        geometryType: descriptor.geometryType,
        featureCount: descriptor.featureCount,
        detectedCrs: descriptor.crs.label,
        targetType: atlasMetadata?.projectState ? 'project' : mapping.targetType,
        distributionType: mapping.distributionType || '',
        propertyMapping: { id: mapping.idField, name: mapping.nameField, country: mapping.countryField, parent: mapping.parentField, level: mapping.levelField, color: mapping.colorField },
        targetCountryId: mapping.targetCountryId,
        fallbackCountryId: mapping.targetCountryId,
        useFeatureCountryField: mapping.useFeatureCountryField,
        parentId: mapping.parentId,
        openMode: mapping.openMode,
        mergePolicy: mapping.targetType === 'country' ? 'same-id-multipolygon' : 'preserve-features',
      }),
      sourceInfo: {
        importedAt: new Date().toISOString(),
        files: fileHashes,
        driver: descriptor.driverName,
        layer: descriptor.layerName,
        sourceCrs: descriptor.crs.label,
        fields: descriptor.fieldDefinitions || [],
        mapping: { id: mapping.idField, name: mapping.nameField, country: mapping.countryField, parent: mapping.parentField, level: mapping.levelField, color: mapping.colorField },
      },
    };
  }

  function reportHtml(session) {
    const { missing, ambiguous } = session.prepared.report;
    const lines = [];
    if (missing.length) lines.push(`<strong>누락 참조 ${missing.length}개</strong><br>${missing.slice(0, 5).map(escapeHtml).join('<br>')}`);
    if (ambiguous.length) lines.push(`<strong>동명 참조 ${ambiguous.length}개</strong><br>${ambiguous.slice(0, 5).map(escapeHtml).join('<br>')}`);
    if (!lines.length) lines.push(`선택 파일 ${session.prepared.originals.length}개 · 참조 경로 정상`);
    return lines.join('<br><br>');
  }

  function importMappingFromUi() {
    const targetType = document.getElementById('gisTargetType').value;
    return {
      sourceKind: importSourceKind,
      targetType,
      distributionType: document.getElementById('gisDistributionType').value,
      idField: document.getElementById('gisIdField').value,
      nameField: document.getElementById('gisNameField').value,
      countryField: document.getElementById('gisCountryField').value,
      parentField: document.getElementById('gisParentField').value,
      levelField: document.getElementById('gisLevelField').value,
      colorField: document.getElementById('gisColorField').value,
      sourceCrs: document.getElementById('gisCrsInput').value.trim(),
      groupDuplicates: true,
      targetCountryId: document.getElementById('gisTargetCountry').value,
      useFeatureCountryField: document.getElementById('gisUseCountryField').checked,
      parentId: document.getElementById('gisParentUnit').value,
      openMode: importSourceKind === 'project' ? 'replace' : (targetType === 'country' ? document.getElementById('gisOpenMode').value : 'merge'),
    };
  }

  function renderImportImpact(impact, mapping, descriptor) {
    const container = document.getElementById('gisImportImpactSummary');
    if (!container) return;
    container.replaceChildren();
    if (!PARTITION_IMPORT_TARGETS.has(mapping.targetType) || !impact) {
      const mode = mapping.openMode === 'replace' ? '새 프로젝트' : '현재 지도';
      container.append(Object.assign(document.createElement('p'), { textContent: `${descriptor.featureCount.toLocaleString()}개 객체를 ${mode}에 적용합니다.` }));
      return;
    }
    const ownerNames = new Map((wizardOptions.countryOptions || []).map(country => [String(country.id), country.name || country.id]));
    const formatArea = value => `${Math.round(Number(value) || 0).toLocaleString()} km²`;
    container.append(Object.assign(document.createElement('p'), {
      textContent: `${impact.featureCount.toLocaleString()}개 ${mapping.targetType === 'administrative' ? '행정구역' : '권역'} · 전체 ${formatArea(impact.totalAreaKm2)}`,
    }));
    const list = document.createElement('ul');
    for (const group of impact.groups || []) {
      const ownerName = ownerNames.get(String(group.targetCountryId)) || group.targetCountryId;
      const donors = (group.donors || []).map(donor => `${ownerNames.get(String(donor.countryId)) || donor.countryId} ${formatArea(donor.areaKm2)}`).join(', ');
      const details = [
        `소속 국가: ${ownerName}`,
        donors ? `영토를 내주는 국가: ${donors}` : '영토를 내주는 국가: 없음',
        `기존 소속국 면적: ${formatArea(group.existingOwnerAreaKm2)}`,
        `기존 국가 밖 신규 편입: ${formatArea(group.newAreaKm2)}`,
      ];
      if (group.absorbedCountryIds?.length) details.push(`완전히 흡수되는 국가: ${group.absorbedCountryIds.length}개`);
      for (const detail of details) list.append(Object.assign(document.createElement('li'), { textContent: detail }));
    }
    if (impact.unresolvedCountryValueCount) list.append(Object.assign(document.createElement('li'), { textContent: `해석하지 못한 객체별 국가값 ${impact.unresolvedCountryValueCount}개는 공통 국가를 사용합니다.` }));
    container.append(list);
  }

  async function openImportWizard(files, options = {}) {
    wizardOptions = options || {};
    importSourceKind = 'vector';
    importStepRoute = [0, 1, 2, 3, 4];
    openWizardModal();
    const kicker = document.querySelector('#gisImportModal .ui-dialog-kicker');
    if (kicker) kicker.textContent = '파일 불러오기';
    const title = document.getElementById('gisImportTitle');
    if (title) title.textContent = '파일 확인';
    const closeButton = document.getElementById('gisImportCancelBtn');
    closeButton?.setAttribute('aria-label', '파일 불러오기 닫기');
    clearWizardError();
    populateTargetCountries();
    updateTargetFields();
    setImportMobileStep(0);
    const form = document.getElementById('gisImportForm');
    const confirmButton = document.getElementById('gisImportConfirmBtn');
    const cancelButton = document.getElementById('gisImportCancelBtn');
    const layerSelect = document.getElementById('gisLayerSelect');
    const modeSelect = document.getElementById('gisOpenMode');
    form.classList.add('is-busy');
    confirmButton.disabled = true;
    setWizardProgress('선택한 GIS 파일을 확인하는 중입니다.', 2);
    try {
      const session = await inspectFiles(files, setWizardProgress);
      layerSelect.replaceChildren();
      session.descriptors.forEach((descriptor, index) => {
        const fileLabel = basename(descriptor.datasetPath) || descriptor.driverName;
        layerSelect.add(new Option(`${fileLabel} › ${descriptor.layerName} · ${descriptor.featureCount.toLocaleString()}개`, String(index)));
      });
      const projectLayerIndex = session.projectMetadata?.projectState
        ? session.descriptors.findIndex(descriptor => descriptor.layerName === 'countries')
        : -1;
      if (projectLayerIndex >= 0) layerSelect.value = String(projectLayerIndex);
      document.getElementById('gisLayerRow')?.classList.toggle('hidden', session.descriptors.length === 1 || projectLayerIndex >= 0);
      document.getElementById('gisSecurityNote')?.classList.toggle('hidden', !session.prepared.originals.some(file => ['qgs', 'qgz'].includes(extension(file.name))));
      document.getElementById('gisSourceReport').innerHTML = reportHtml(session);
      importSourceKind = session.projectMetadata?.projectState ? 'project' : 'vector';
      importStepRoute = importSourceKind === 'project' ? [0, 4] : [0, 1, 2, 3, 4];
      if (importSourceKind === 'project') {
        document.getElementById('gisSourceReport').innerHTML = '<strong>PandoLab 프로젝트 감지</strong><br>프로젝트 데이터와 내부 속성을 그대로 엽니다.';
        if (kicker) kicker.textContent = 'PandoLab 프로젝트';
        if (title) title.textContent = '프로젝트 불러오기';
      } else {
        if (kicker) kicker.textContent = '벡터 데이터';
        if (title) title.textContent = '벡터 데이터 불러오기';
      }
      document.getElementById('gisTargetTypeRow')?.classList.toggle('hidden', importSourceKind === 'project');
      const targetSelect = document.getElementById('gisTargetType');
      let convertedCache = null;
      let impactCache = null;
      const invalidatePrepared = () => { convertedCache = null; impactCache = null; clearWizardError(); };
      const refresh = () => {
        const descriptor = session.descriptors[Number(layerSelect.value) || 0];
        targetSelect.value = importSourceKind === 'project' ? 'country' : options.targetType || suggestedTarget(descriptor, session.prepared.manifest);
        updateWizardFields(descriptor);
        invalidatePrepared();
      };
      layerSelect.onchange = refresh;
      targetSelect.onchange = () => { invalidatePrepared(); updateTargetFields(); };
      for (const id of ['gisIdField', 'gisNameField', 'gisCountryField', 'gisParentField', 'gisLevelField', 'gisColorField', 'gisDistributionType', 'gisParentUnit']) {
        document.getElementById(id).onchange = () => { invalidatePrepared(); updateTargetFields(); };
      }
      document.getElementById('gisUseCountryField').onchange = () => { invalidatePrepared(); updateTargetFields(); };
      document.getElementById('gisTargetCountry').onchange = () => { invalidatePrepared(); updateTargetFields(); };
      document.getElementById('gisOpenModeControl').onclick = event => {
        const button = event.target.closest('[data-gis-open-mode]');
        if (!button) return;
        modeSelect.value = button.dataset.gisOpenMode;
        for (const candidate of document.querySelectorAll('[data-gis-open-mode]')) {
          const active = candidate === button;
          candidate.classList.toggle('active', active);
          candidate.setAttribute('aria-checked', String(active));
        }
        invalidatePrepared();
        updateTargetFields();
      };
      refresh();
      form.classList.remove('is-busy');
      document.getElementById('gisImportProgress')?.classList.add('hidden');
      confirmButton.disabled = false;
      const backButton = document.getElementById('gisImportBackBtn');
      const nextButton = document.getElementById('gisImportNextBtn');
      const prepareConverted = async () => {
        const descriptor = session.descriptors[Number(layerSelect.value) || 0];
        const mapping = importMappingFromUi();
        if (PARTITION_IMPORT_TARGETS.has(mapping.targetType) && !mapping.targetCountryId) {
          throw new Error('권역·행정구역을 가져오려면 소속 국가를 선택해야 합니다.');
        }
        if (mapping.useFeatureCountryField && !mapping.countryField) throw new Error('객체별 소속 국가에 사용할 속성을 선택하세요.');
        const crsInput = document.getElementById('gisCrsInput');
        if (crsInput?.required && !/^EPSG:\d+$/i.test(crsInput.value.trim())) throw new Error('좌표계를 EPSG 코드로 입력하세요.');
        if (!convertedCache) convertedCache = await convertSelectedLayer(descriptor, mapping, setWizardProgress);
        if (!impactCache && typeof options.planImpact === 'function' && PARTITION_IMPORT_TARGETS.has(mapping.targetType)) {
          setWizardProgress('영토 이전 영향을 계산하는 중입니다.', 88);
          impactCache = await options.planImpact(convertedCache.collection, mapping);
        }
        renderImportImpact(impactCache, mapping, descriptor);
        document.getElementById('gisImportProgress')?.classList.add('hidden');
        return { descriptor, mapping, converted: convertedCache, impact: impactCache };
      };
      backButton.onclick = () => {
        clearWizardError();
        const index = importStepRoute.indexOf(importMobileStep);
        setImportMobileStep(importStepRoute[Math.max(0, index - 1)], { focus: true });
      };
      nextButton.onclick = async () => {
        try {
          clearWizardError();
          if (importMobileStep === 1 && PARTITION_IMPORT_TARGETS.has(targetSelect.value) && !document.getElementById('gisTargetCountry').value) {
            document.getElementById('gisTargetCountry').focus();
            throw new Error('소속 국가를 선택하세요. 교차 면적만으로 자동 확정하지 않습니다.');
          }
          if (importMobileStep === 2) await prepareConverted();
          const index = importStepRoute.indexOf(importMobileStep);
          setImportMobileStep(importStepRoute[Math.min(importStepRoute.length - 1, index + 1)], { focus: true });
        } catch (error) {
          form.classList.remove('is-busy');
          document.getElementById('gisImportProgress')?.classList.add('hidden');
          showWizardError(error?.message || String(error));
        }
      };
      setImportMobileStep(0);
      return await new Promise((resolve, reject) => {
        const cancel = async () => {
          closeWizardModal();
          await closeActiveSession();
          reject(new DOMException('사용자가 GIS 가져오기를 취소했습니다.', 'AbortError'));
        };
        cancelButton.onclick = cancel;
        document.querySelector('[data-gis-cancel="true"]').onclick = cancel;
        document.querySelector('#gisImportModal .ui-dialog-backdrop').onclick = cancel;
        confirmButton.onclick = async () => {
          try {
            clearWizardError();
            form.classList.add('is-busy');
            confirmButton.disabled = true;
            const prepared = await prepareConverted();
            const { mapping } = prepared;
            const result = { ...prepared.converted, sourceKind: importSourceKind, targetType: mapping.targetType, distributionType: mapping.distributionType, mapping, impactPlan: prepared.impact, openMode: mapping.openMode, mergeStrategy: document.getElementById('gisMergeStrategy').value };
            closeWizardModal();
            await closeActiveSession();
            resolve(result);
          } catch (error) {
            form.classList.remove('is-busy');
            confirmButton.disabled = false;
            document.getElementById('gisImportProgress')?.classList.add('hidden');
            showWizardError(error?.message || String(error));
          }
        };
      });
    } catch (error) {
      form.classList.remove('is-busy');
      confirmButton.disabled = true;
      document.getElementById('gisImportProgress')?.classList.add('hidden');
      showWizardError(error?.message || String(error));
      cancelButton.onclick = () => { closeWizardModal(); closeActiveSession(); };
      throw error;
    }
  }

  const atlasReservedFields = ['pandolab_id', 'pandolab_name', 'pandolab_color', 'pandolab_capital', 'pandolab_notes', 'pandolab_source_properties', 'pandolab_field_map'];

  function reservedFieldMapping(collection) {
    const keys = new Set((collection?.features || []).flatMap(feature => Object.keys(feature.properties || {})));
    const mapping = {};
    for (const key of atlasReservedFields) {
      if (!keys.has(key)) continue;
      let replacement = `source_${key}`;
      while (keys.has(replacement) || Object.values(mapping).includes(replacement)) replacement = `source_${replacement}`;
      mapping[key] = replacement;
    }
    return mapping;
  }

  function exportCountryProperties(feature, overrides, reservedMap) {
    const source = { ...(feature.properties || {}) };
    delete source.editor_centroid;
    delete source.editor_label_anchor;
    delete source.flagDataUrl;
    const id = String(source.editor_id || feature.id || '');
    const override = overrides?.[id] || {};
    const output = {};
    const nested = {};
    const renamed = {};
    const reserved = new Set(atlasReservedFields);
    for (const [key, value] of Object.entries(source)) {
      if (reserved.has(key)) {
        const replacement = reservedMap[key] || `source_${key}`;
        renamed[key] = replacement;
        if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) output[replacement] = value;
        else nested[replacement] = value;
      } else if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) output[key] = value;
      else nested[key] = value;
    }
    output.pandolab_id = id;
    output.pandolab_name = override.name || source.editor_name || source.editor_original_name || source.name || id;
    output.pandolab_color = override.color || source.editor_color || '#63758a';
    output.pandolab_capital = override.capital || source.capital || '';
    output.pandolab_notes = override.notes || source.notes || '';
    output.id = id;
    output.name = output.pandolab_name;
    output.type = 'country';
    output.parent_id = '';
    output.sovereign_id = id;
    output.valid_from = source.validFrom || source.valid_from || '';
    output.valid_to = source.validTo || source.valid_to || '';
    output.color = output.pandolab_color;
    output.style_key = source.style_key || '';
    output.source_library_id = source.sourceLibraryId || source.source_library_id || '';
    output.source_geometry_version = source.sourceGeometryVersion || source.source_geometry_version || '';
    if (Object.keys(nested).length) output.pandolab_source_properties = JSON.stringify(nested);
    if (Object.keys(renamed).length) output.pandolab_field_map = JSON.stringify(renamed);
    return output;
  }

  function countryAssets(overrides) {
    const assets = [];
    for (const [countryId, override] of Object.entries(overrides || {})) {
      const match = String(override?.flagDataUrl || '').match(/^data:([^;,]+);base64,(.+)$/s);
      if (match) assets.push({ countryId, mimeType: match[1], base64: match[2] });
    }
    return assets;
  }

  function rowsAsFeatureCollection(rows) {
    return {
      type: 'FeatureCollection',
      features: (rows || []).filter(row => row?.geometry).map(row => ({
        type: 'Feature',
        id: row.id || row.entry_id || row.pandolab_id || undefined,
        properties: Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'geometry')),
        geometry: row.geometry,
      })),
    };
  }

  function buildGisExportLayers(projectState, selectedLayers = []) {
    const selected = new Set(selectedLayers);
    const territorial = gisAdapters.territorialRows(projectState);
    const distributions = gisAdapters.distributionRows(projectState);
    const reservedMap = reservedFieldMapping(projectState.countriesData);
    const layers = [];
    const add = (category, file, targetType, collection, extra = {}) => {
      if (!selected.has(category) || !collection.features.length) return;
      layers.push({ category, file, targetType, collection, ...extra });
    };
    add('countries', 'countries.geojson', 'country', {
      type: 'FeatureCollection',
      features: (projectState.countriesData?.features || []).map(feature => ({
        type: 'Feature', id: String(feature.properties?.editor_id || feature.id || ''),
        properties: exportCountryProperties(feature, projectState.countryOverrides, reservedMap), geometry: feature.geometry,
      })),
    });
    add('territories', 'territories.geojson', 'territory', rowsAsFeatureCollection(territorial.territories));
    add('administrative', 'administrative.geojson', 'administrative', rowsAsFeatureCollection(territorial.administrative));
    add('regions', 'regions.geojson', 'region', rowsAsFeatureCollection(territorial.regions));
    add('drawings', 'drawings.geojson', 'drawing', { type: 'FeatureCollection', features: structuredClone(projectState.drawings || []) });
    if (selected.has('distributions')) {
      for (const [distributionType, tableName] of Object.entries(gisAdapters.DISTRIBUTION_TABLES)) {
        add('distributions', `${distributionType}_distribution.geojson`, 'distribution', rowsAsFeatureCollection(distributions[tableName]), { distributionType });
      }
    }
    add('labels', 'labels.geojson', 'drawing', {
      type: 'FeatureCollection',
      features: (projectState.labels || []).filter(label => Array.isArray(label.coordinates)).map(label => ({
        type: 'Feature', id: label.id,
        properties: { pandolab_id: label.id, name: label.name || '', kind: label.kind || 'custom', country_id: label.countryId || '', notes: label.notes || '' },
        geometry: { type: 'Point', coordinates: label.coordinates },
      })),
    });
    return layers;
  }

  async function exportGeoJsonBundle(projectState, selectedLayers, progress = () => {}) {
    progress('GeoJSON 레이어를 만드는 중입니다.', 18);
    const layers = buildGisExportLayers(projectState, selectedLayers);
    if (!layers.length) throw new Error('선택한 범주에 내보낼 데이터가 없습니다.');
    const fflate = await getFflate();
    const createdAt = new Date().toISOString();
    const manifest = {
      pandolabExport: true,
      schemaVersion: GIS_MANIFEST_SCHEMA_VERSION,
      crs: 'EPSG:4326',
      createdAt,
      layers: layers.map(layer => ({
        name: withoutExtension(layer.file), file: layer.file, category: layer.category,
        targetType: layer.targetType, distributionType: layer.distributionType || '',
        crs: 'EPSG:4326', featureCount: layer.collection.features.length,
      })),
    };
    const files = {};
    layers.forEach((layer, index) => {
      files[layer.file] = fflate.strToU8(JSON.stringify(layer.collection, null, 2));
      progress(`GeoJSON 레이어 ${index + 1}/${layers.length} 준비 중`, 20 + Math.round(((index + 1) / layers.length) * 55));
    });
    files['manifest.json'] = fflate.strToU8(JSON.stringify(manifest, null, 2));
    const zipped = fflate.zipSync(files, { level: 6 });
    progress(`${layers.length}개 레이어 묶음을 만들었습니다.`, 100);
    return { blob: new Blob([zipped], { type: 'application/zip' }), manifest };
  }

  async function exportGeoPackage(projectState, progress = () => {}, options = {}) {
    const exportMode = options.mode === 'gis' ? 'gis' : 'project';
    const selectedLayers = exportMode === 'gis' ? [...new Set(options.layers || [])] : [];
    const gdal = await getGdal(progress);
    progress(exportMode === 'gis' ? 'GIS용 GeoPackage 구조를 준비하는 중입니다.' : '국가 레이어를 GeoPackage로 변환하는 중입니다.', 25);
    const countries = {
      type: 'FeatureCollection',
      features: [],
    };
    const reservedMap = reservedFieldMapping(projectState.countriesData);
    countries.features = (projectState.countriesData?.features || []).map(feature => ({ type: 'Feature', id: String(feature.properties?.editor_id || feature.id || ''), properties: exportCountryProperties(feature, projectState.countryOverrides, reservedMap), geometry: feature.geometry }));
    const gisLayers = exportMode === 'gis' ? buildGisExportLayers(projectState, selectedLayers) : [];
    const seedCollection = exportMode === 'project' ? countries : gisLayers.find(layer => layer.collection.features.length)?.collection;
    if (!seedCollection?.features?.length) throw new Error(exportMode === 'project' ? '저장할 국가 레이어가 없습니다.' : '선택한 범주에 내보낼 데이터가 없습니다.');
    const source = new File([JSON.stringify(seedCollection)], `pandolab_export_${Date.now()}.geojson`, { type: 'application/geo+json' });
    const opened = await gdal.open(source);
    const dataset = opened.datasets?.[0];
    if (!dataset) throw new Error('GeoPackage 변환용 국가 데이터를 열 수 없습니다.');
    let bytes;
    try {
      const layerName = exportMode === 'project' ? 'countries' : 'pandolab_export_seed';
      const output = await gdal.ogr2ogr(dataset, ['-f', 'GPKG', '-nln', layerName, '-nlt', 'PROMOTE_TO_MULTI', '-t_srs', 'EPSG:4326'], `PandoLab_${Date.now()}`);
      bytes = await gdal.getFileBytes(output);
    } finally {
      await gdal.close(dataset);
    }
    progress(exportMode === 'project' ? '지명·지형지물·국기와 프로젝트 설정을 기록하는 중입니다.' : '선택한 GIS 레이어를 기록하는 중입니다.', 72);
    const countryOverrides = Object.fromEntries(Object.entries(projectState.countryOverrides || {}).map(([id, override]) => {
      const copy = { ...(override || {}) };
      delete copy.flagDataUrl;
      return [id, copy];
    }));
    const stateForPackage = {
      ...projectState,
      countryOverrides,
      countryAssets: exportMode === 'project' ? countryAssets(projectState.countryOverrides) : [],
      sourceInfo: {
        ...(projectState.sourceInfo || {}),
        exportedAt: new Date().toISOString(),
        reservedFieldMapping: reservedMap,
        physicalDatasets: projectState.physicalSourceInfo || null,
      },
    };
    const exactBytes = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
    const result = await callGpkgWorker('write', exactBytes.buffer, { projectState: stateForPackage, exportMode, selectedLayers });
    progress(exportMode === 'project' ? 'GeoPackage 저장 준비를 마쳤습니다.' : 'GIS용 GeoPackage를 만들었습니다.', 100);
    return new Blob([result.buffer], { type: 'application/geopackage+sqlite3' });
  }

  window.PandoLabGIS = Object.freeze({
    supportedExtensions: [...supportedExtensions],
    openImportWizard,
    exportGeoPackage,
    exportGeoJsonBundle,
    close: async () => {
      await closeActiveSession();
      gpkgWorker?.terminate();
      gpkgWorker = null;
    },
  });
})();
