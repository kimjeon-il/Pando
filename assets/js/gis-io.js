/* AtlasWright GIS I/O
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
  const gpkgWorkerUrlObject = new URL('workers/gis-gpkg-worker.js', baseUrl);
  gpkgWorkerUrlObject.searchParams.set('v', '0.14.2');
  const gpkgWorkerUrl = gpkgWorkerUrlObject.href;
  const supportedExtensions = new Set(['gpkg', 'geojson', 'json', 'shp', 'shx', 'dbf', 'prj', 'cpg', 'shz', 'zip', 'kml', 'kmz', 'gml', 'xml', 'fgb', 'qgz', 'qgs']);
  const archiveExtensions = new Set(['qgz', 'shz', 'zip', 'kmz']);
  const inputLimit = 512 * 1024 * 1024;
  const extractedLimit = 1024 * 1024 * 1024;
  const archiveEntryLimit = 10000;
  let gdalPromise = null;
  let gpkgWorker = null;
  let workerSequence = 0;
  const workerPending = new Map();
  let activeSession = null;

  function extension(name) {
    const match = String(name || '').toLowerCase().match(/\.([^.\/]+)$/);
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
    gpkgWorker = new Worker(gpkgWorkerUrl, { name: 'atlaswright-gpkg' });
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
      console.debug('AtlasWright GeoPackage metadata not found:', error);
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
    for (const rawName of names) {
      const safeName = validateArchivePath(rawName);
      const bytes = entries[rawName];
      total += bytes.byteLength;
      if (total > extractedLimit || (file.size > 0 && total > file.size * 100)) throw new Error('압축 해제 크기가 안전 한도를 초과했습니다.');
      const ext = extension(safeName);
      if (!supportedExtensions.has(ext) || archiveExtensions.has(ext)) continue;
      files.push(new File([bytes], basename(safeName), { type: 'application/octet-stream', lastModified: file.lastModified }));
      files[files.length - 1].__atlasArchivePath = safeName;
    }
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
      const dbMatch = datasource.match(/dbname=['\"]([^'\"]+)['\"]/i);
      if (dbMatch) sourcePath = dbMatch[1];
      const tableMatch = datasource.match(/table=['\"]?([^'\"\s(]+)['\"]?/i);
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
    for (let i = 0; i < originals.length; i += 1) {
      const file = originals[i];
      const ext = extension(file.name);
      progress(`파일을 확인하는 중입니다. ${i + 1}/${originals.length}`, 4 + Math.round((i / originals.length) * 10));
      if (!supportedExtensions.has(ext)) continue;
      if (archiveExtensions.has(ext)) {
        const unpacked = await unpackArchive(file);
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
    return { originals, dataFiles, qgsLayers, report };
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
    const gdal = await getGdal(progress);
    progress('벡터 레이어를 검사하는 중입니다.', 42);
    const opened = await gdal.open(prepared.dataFiles);
    if (!opened.datasets?.length) throw new Error(`벡터 파일을 열 수 없습니다.${opened.errors?.length ? ` ${opened.errors.map(error => error.message || error).join(' · ')}` : ''}`);
    const descriptors = [];
    for (let datasetIndex = 0; datasetIndex < opened.datasets.length; datasetIndex += 1) {
      const dataset = opened.datasets[datasetIndex];
      let info = dataset.info;
      try { info = await gdal.ogrinfo(dataset, ['-so', '-al']); }
      catch (error) { console.warn('AtlasWright layer inspection failed', error); }
      const layers = info?.layers || dataset.info?.layers || [];
      for (const layer of layers) {
        if (Number(layer.featureCount) === 0) continue;
        const geometryType = layerGeometryType(layer);
        const hasGeometryField = Array.isArray(layer?.geometryFields) && layer.geometryFields.length > 0;
        const polygonCandidate = /polygon|surface/i.test(geometryType) || (hasGeometryField && /^(geometry|unknown|알 수 없음)/i.test(geometryType));
        if (!polygonCandidate || /line|point/i.test(geometryType)) continue;
        const crs = layerCrs(layer, info?.driverShortName || dataset.info?.driverName || '');
        const qgs = styleForLayer(prepared.qgsLayers, layer.name, dataset.path || dataset.info?.dsName || '');
        descriptors.push({
          datasetIndex,
          layerName: layer.name,
          featureCount: Number(layer.featureCount || 0),
          geometryType,
          fields: layerFields(layer),
          fieldDefinitions: layerFieldDefinitions(layer),
          crs,
          driverName: info?.driverLongName || info?.driverShortName || dataset.info?.driverName || 'OGR',
          datasetPath: dataset.path || dataset.info?.dsName || '',
          qgsStyle: qgs?.style || null,
          qgsLabelField: qgs?.labelField || '',
        });
      }
    }
    if (!descriptors.length) throw new Error('Polygon/MultiPolygon 국가 경계 레이어를 찾지 못했습니다.');
    activeSession = { gdal, datasets: opened.datasets, descriptors, prepared };
    progress(`국가 경계 후보 ${descriptors.length}개 확인됨`, 100);
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

  function populateFieldSelect(select, fields, { includeFid = false, includeStyle = false, selected = '' } = {}) {
    select.replaceChildren();
    if (includeFid) select.add(new Option('원본 FID', '__fid__'));
    else select.add(new Option('사용 안 함', ''));
    if (includeStyle) select.add(new Option('QGIS 기본 스타일', '__qgis_style__'));
    fields.forEach(field => select.add(new Option(field, field)));
    select.value = selected || (includeFid ? '__fid__' : '');
  }

  function updateWizardFields(descriptor) {
    const fields = descriptor.fields || [];
    populateFieldSelect(document.getElementById('gisIdField'), fields, { includeFid: true, selected: autoField(fields, ['aw_id', 'editor_id', 'ADM0_A3', 'ISO_A3', 'id']) || '__fid__' });
    populateFieldSelect(document.getElementById('gisNameField'), fields, { selected: autoField(fields, ['aw_name', 'NAME_KO', 'name_ko', 'NAME', 'name', descriptor.qgsLabelField]) });
    populateFieldSelect(document.getElementById('gisColorField'), fields, { includeStyle: true, selected: descriptor.qgsStyle ? '__qgis_style__' : autoField(fields, ['aw_color', 'editorColor', 'color', 'fill']) });
    const crsInput = document.getElementById('gisCrsInput');
    crsInput.value = descriptor.crs.source || '';
    crsInput.disabled = descriptor.crs.hasCrs;
    crsInput.required = !descriptor.crs.hasCrs;
    const dimensionNote = /(?:^|\s)(?:Z|M|ZM)(?:\s|$)/i.test(descriptor.geometryType) ? ' · Z/M은 XY로 편집' : '';
    document.getElementById('gisLayerDetails').textContent = `${descriptor.featureCount.toLocaleString()}개 · ${descriptor.geometryType} · ${descriptor.crs.label} · ${descriptor.driverName}${dimensionNote}`;
  }

  function setWizardProgress(message, percent = null) {
    const status = document.getElementById('gisImportStatus');
    const bar = document.getElementById('gisImportProgressBar');
    if (status) status.textContent = message;
    status?.classList.remove('error');
    if (bar && percent != null) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function openWizardModal() {
    document.getElementById('gisImportModal')?.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeWizardModal() {
    document.getElementById('gisImportModal')?.classList.add('hidden');
    document.body.classList.remove('modal-open');
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
      if (properties.aw_source_properties) {
        try { properties = { ...JSON.parse(properties.aw_source_properties), ...properties }; } catch (_) {}
      }
      const rawId = mapping.idField === '__fid__' ? (raw.id ?? index + 1) : properties[mapping.idField];
      const id = String(rawId ?? '').trim();
      if (!id) throw new Error(`국가 ID가 비어 있는 객체가 있습니다: ${raw.id ?? index + 1}`);
      const name = String(mapping.nameField ? (properties[mapping.nameField] ?? '') : '').trim() || `국가 ${id}`;
      let color = '';
      if (mapping.colorField === '__qgis_style__') color = applyQgsColor(descriptor.qgsStyle, properties);
      else if (mapping.colorField) color = String(properties[mapping.colorField] || '');
      if (!/^#[0-9a-f]{6}$/i.test(color)) color = '#63758a';
      const feature = {
        type: 'Feature', id,
        properties: { ...properties, editor_id: id, iso_a3: properties.iso_a3 || properties.ISO_A3 || properties.ADM0_A3 || id, editor_original_name: name, editor_name: name, editor_color: color },
        geometry: { type: 'MultiPolygon', coordinates },
      };
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(feature);
    }
    if (invalid.length) throw new Error(`유효하지 않은 Polygon/MultiPolygon 객체가 있습니다: ${invalid.slice(0, 8).join(', ')}${invalid.length > 8 ? '…' : ''}`);
    const duplicates = [...groups.entries()].filter(([, values]) => values.length > 1);
    if (duplicates.length && !mapping.groupDuplicates) throw new Error(`중복 국가 ID가 있습니다: ${duplicates.slice(0, 8).map(([id]) => id).join(', ')}`);
    const features = [];
    for (const [id, values] of groups) {
      if (values.length === 1) { features.push(values[0]); continue; }
      const first = values[0];
      first.geometry.coordinates = values.flatMap(value => value.geometry.coordinates);
      first.properties.aw_source_rows = JSON.stringify(values.map(value => value.properties));
      first.properties.editor_id = id;
      features.push(first);
    }
    return { type: 'FeatureCollection', features };
  }

  async function layerAsGeoJson(gdal, dataset, layerName, outputTag) {
    const output = await gdal.ogr2ogr(dataset, ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-dim', 'XY', layerName], `atlaswright_${outputTag}_${Date.now()}`);
    return JSON.parse(new TextDecoder().decode(await gdal.getFileBytes(output)));
  }

  async function readAtlasVectorState(gdal, dataset) {
    const layerNames = new Set((dataset.info?.layers || []).map(layer => layer.name));
    const hasPlaces = layerNames.has('places');
    const drawingLayerNames = ['drawings_point', 'drawings_line', 'drawings_polygon'].filter(name => layerNames.has(name));
    const state = {};
    if (hasPlaces) {
      const collection = await layerAsGeoJson(gdal, dataset, 'places', 'places');
      state.labels = (collection.features || []).filter(feature => feature.geometry?.type === 'Point').map((feature, index) => ({
        id: String(feature.properties?.aw_id || feature.id || `place_${index + 1}`),
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
            id: String(basic.aw_id || feature.id || `${layerName}_${index + 1}`),
            properties: {
              ...properties,
              name: basic.name ?? properties.name ?? '',
              category: basic.category ?? properties.category ?? 'custom',
              editorColor: basic.color ?? properties.editorColor ?? properties.color ?? '#8c68d8',
              notes: basic.notes ?? properties.notes ?? '',
            },
            geometry: feature.geometry,
          });
        }
      }
    }
    return state;
  }

  async function convertSelectedLayer(descriptor, mapping, progress) {
    if (!activeSession) throw new Error('GIS 가져오기 세션이 종료되었습니다.');
    if (/curvepolygon|circularstring|compoundcurve/i.test(descriptor.geometryType)) throw new Error('곡선 표면은 자동 변형하지 않습니다. QGIS에서 Polygon/MultiPolygon으로 변환해 주세요.');
    const { gdal, datasets, prepared } = activeSession;
    const dataset = datasets[descriptor.datasetIndex];
    const options = ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-dim', 'XY', '-nlt', 'PROMOTE_TO_MULTI', '-fieldTypeToString', 'Integer64,Integer64List', '-lco', 'RFC7946=YES'];
    if (!descriptor.crs.hasCrs) {
      if (!/^EPSG:\d+$/i.test(mapping.sourceCrs || '')) throw new Error('좌표계가 없는 레이어에는 EPSG 코드를 입력해 주세요.');
      options.push('-s_srs', mapping.sourceCrs.toUpperCase());
    }
    options.push(descriptor.layerName);
    progress('국가 경계를 EPSG:4326으로 변환하는 중입니다.', 55);
    const output = await gdal.ogr2ogr(dataset, options, `atlaswright_import_${Date.now()}`);
    const bytes = await gdal.getFileBytes(output);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    const countriesData = normalizeCountryFeatures(parsed, descriptor, mapping);
    progress('원본 속성과 프로젝트 정보를 확인하는 중입니다.', 78);
    const sourceFile = prepared.dataFiles.find(file => file.name.toLowerCase() === basename(descriptor.datasetPath).toLowerCase())
      || prepared.dataFiles.find(file => withoutExtension(file.name).toLowerCase() === withoutExtension(descriptor.datasetPath).toLowerCase());
    const atlasMetadata = sourceFile && extension(sourceFile.name) === 'gpkg' ? await readAtlasMetadata(sourceFile) : null;
    if (atlasMetadata?.projectState) {
      const vectorState = await readAtlasVectorState(gdal, dataset);
      atlasMetadata.projectState = { ...atlasMetadata.projectState, ...vectorState };
    }
    const fileHashes = [];
    for (const file of prepared.originals) fileHashes.push({ name: file.name, size: file.size, sha256: await sha256File(file) });
    progress('가져오기 미리보기를 준비했습니다.', 100);
    return {
      countriesData,
      atlasMetadata,
      sourceInfo: {
        importedAt: new Date().toISOString(),
        files: fileHashes,
        driver: descriptor.driverName,
        layer: descriptor.layerName,
        sourceCrs: descriptor.crs.label,
        fields: descriptor.fieldDefinitions || [],
        mapping: { id: mapping.idField, name: mapping.nameField, color: mapping.colorField },
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

  async function openImportWizard(files) {
    openWizardModal();
    const form = document.getElementById('gisImportForm');
    const confirmButton = document.getElementById('gisImportConfirmBtn');
    const cancelButton = document.getElementById('gisImportCancelBtn');
    const layerSelect = document.getElementById('gisLayerSelect');
    const modeSelect = document.getElementById('gisOpenMode');
    const mergeRow = document.getElementById('gisMergeStrategyRow');
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
      document.getElementById('gisSourceReport').innerHTML = reportHtml(session);
      const refresh = () => updateWizardFields(session.descriptors[Number(layerSelect.value) || 0]);
      layerSelect.onchange = refresh;
      modeSelect.onchange = () => mergeRow.classList.toggle('hidden', modeSelect.value !== 'merge');
      modeSelect.onchange();
      refresh();
      form.classList.remove('is-busy');
      confirmButton.disabled = false;
      return await new Promise((resolve, reject) => {
        const cancel = async () => {
          closeWizardModal();
          await closeActiveSession();
          reject(new DOMException('사용자가 GIS 가져오기를 취소했습니다.', 'AbortError'));
        };
        cancelButton.onclick = cancel;
        document.querySelector('[data-gis-cancel="true"]').onclick = cancel;
        document.querySelector('#gisImportModal .gis-modal-dim').onclick = cancel;
        confirmButton.onclick = async () => {
          try {
            form.classList.add('is-busy');
            confirmButton.disabled = true;
            const descriptor = session.descriptors[Number(layerSelect.value) || 0];
            const mapping = {
              idField: document.getElementById('gisIdField').value,
              nameField: document.getElementById('gisNameField').value,
              colorField: document.getElementById('gisColorField').value,
              sourceCrs: document.getElementById('gisCrsInput').value.trim(),
              groupDuplicates: document.getElementById('gisGroupDuplicates').checked,
            };
            const converted = await convertSelectedLayer(descriptor, mapping, setWizardProgress);
            const result = { ...converted, openMode: modeSelect.value, mergeStrategy: document.getElementById('gisMergeStrategy').value };
            closeWizardModal();
            await closeActiveSession();
            resolve(result);
          } catch (error) {
            form.classList.remove('is-busy');
            confirmButton.disabled = false;
            setWizardProgress(error?.message || String(error), 100);
            document.getElementById('gisImportStatus')?.classList.add('error');
          }
        };
      });
    } catch (error) {
      form.classList.remove('is-busy');
      confirmButton.disabled = true;
      setWizardProgress(error?.message || String(error), 100);
      document.getElementById('gisImportStatus')?.classList.add('error');
      cancelButton.onclick = () => { closeWizardModal(); closeActiveSession(); };
      throw error;
    }
  }

  const atlasReservedFields = ['aw_id', 'aw_name', 'aw_color', 'aw_capital', 'aw_notes', 'aw_source_properties', 'aw_field_map'];

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
    output.aw_id = id;
    output.aw_name = override.name || source.editor_name || source.editor_original_name || source.name || id;
    output.aw_color = override.color || source.editor_color || '#63758a';
    output.aw_capital = override.capital || source.capital || '';
    output.aw_notes = override.notes || source.notes || '';
    if (Object.keys(nested).length) output.aw_source_properties = JSON.stringify(nested);
    if (Object.keys(renamed).length) output.aw_field_map = JSON.stringify(renamed);
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

  async function exportGeoPackage(projectState, progress = () => {}) {
    const gdal = await getGdal(progress);
    progress('국가 레이어를 GeoPackage로 변환하는 중입니다.', 25);
    const countries = {
      type: 'FeatureCollection',
      features: [],
    };
    const reservedMap = reservedFieldMapping(projectState.countriesData);
    countries.features = (projectState.countriesData?.features || []).map(feature => ({ type: 'Feature', id: String(feature.properties?.editor_id || feature.id || ''), properties: exportCountryProperties(feature, projectState.countryOverrides, reservedMap), geometry: feature.geometry }));
    if (!countries.features.length) throw new Error('저장할 국가 레이어가 없습니다.');
    const source = new File([JSON.stringify(countries)], `atlaswright_export_${Date.now()}.geojson`, { type: 'application/geo+json' });
    const opened = await gdal.open(source);
    const dataset = opened.datasets?.[0];
    if (!dataset) throw new Error('GeoPackage 변환용 국가 데이터를 열 수 없습니다.');
    let bytes;
    try {
      const output = await gdal.ogr2ogr(dataset, ['-f', 'GPKG', '-nln', 'countries', '-nlt', 'PROMOTE_TO_MULTI', '-t_srs', 'EPSG:4326'], `AtlasWright_${Date.now()}`);
      bytes = await gdal.getFileBytes(output);
    } finally {
      await gdal.close(dataset);
    }
    progress('지명·지형지물·국기와 프로젝트 설정을 기록하는 중입니다.', 72);
    const countryOverrides = Object.fromEntries(Object.entries(projectState.countryOverrides || {}).map(([id, override]) => {
      const copy = { ...(override || {}) };
      delete copy.flagDataUrl;
      return [id, copy];
    }));
    const stateForPackage = {
      ...projectState,
      countryOverrides,
      countryAssets: countryAssets(projectState.countryOverrides),
      sourceInfo: {
        ...(projectState.sourceInfo || {}),
        exportedAt: new Date().toISOString(),
        reservedFieldMapping: reservedMap,
        physicalDatasets: projectState.physicalSourceInfo || null,
      },
    };
    delete stateForPackage.countriesData;
    const exactBytes = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
    const result = await callGpkgWorker('write', exactBytes.buffer, { projectState: stateForPackage });
    progress('GeoPackage 저장 준비를 마쳤습니다.', 100);
    return new Blob([result.buffer], { type: 'application/geopackage+sqlite3' });
  }

  window.AtlasWrightGIS = Object.freeze({
    supportedExtensions: [...supportedExtensions],
    openImportWizard,
    exportGeoPackage,
    close: async () => {
      await closeActiveSession();
      gpkgWorker?.terminate();
      gpkgWorker = null;
    },
  });
})();
