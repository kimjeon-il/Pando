export function resolveRenderPixelRatioValue(devicePixelRatio, mobileLayout = false) {
  const deviceRatio = Math.max(1, Number(devicePixelRatio || 1));
  return Math.min(mobileLayout ? 2 : 3, deviceRatio);
}

export function createCountryGeometryRevisionTracker() {
  let committedRevision = 0;
  let displayedRevision = 0;
  let taskToken = 0;
  const pendingRevisions = new Map();

  const normalizedIds = ids => [...new Set([...(ids || [])].map(String).filter(Boolean))];

  function beginCommit(ids) {
    committedRevision += 1;
    taskToken += 1;
    const normalized = normalizedIds(ids);
    for (const id of normalized) pendingRevisions.set(id, committedRevision);
    return { ids: normalized, revision: committedRevision, token: taskToken };
  }

  function beginTask(revision = committedRevision) {
    taskToken += 1;
    return { revision: Number(revision || 0), token: taskToken };
  }

  function isCurrent(token, revision) {
    return Number(token) === taskToken && Number(revision) === committedRevision;
  }

  function markDisplayed(ids, revision) {
    const numericRevision = Number(revision || 0);
    if (numericRevision < committedRevision) return [];
    const cleared = [];
    for (const id of normalizedIds(ids)) {
      const pendingRevision = pendingRevisions.get(id);
      if (pendingRevision === undefined || pendingRevision > numericRevision) continue;
      pendingRevisions.delete(id);
      cleared.push(id);
    }
    displayedRevision = Math.max(displayedRevision, numericRevision);
    return cleared;
  }

  function reset() {
    taskToken += 1;
    pendingRevisions.clear();
    committedRevision += 1;
    return committedRevision;
  }

  return Object.freeze({
    beginCommit,
    beginTask,
    isCurrent,
    markDisplayed,
    reset,
    committedRevision: () => committedRevision,
    displayedRevision: () => displayedRevision,
    taskToken: () => taskToken,
    pendingIds: () => [...pendingRevisions.keys()],
    pendingRevision: id => pendingRevisions.get(String(id)),
    isPending: id => pendingRevisions.has(String(id)),
  });
}

export function createGpuMapRenderer(deps) {
  const {
    $,
    APP_VERSION,
    ASSET_REVISION,
    PHYSICAL_DATA_BASE_URL,
    activeProjection,
    countryColor,
    countryFeatureById,
    countryOutlineFeature,
    d3,
    deepClone,
    defaultCountryColor,
    flatProjection,
    getSystemTheme,
    globeProjection,
    hydroDisplayColor,
    hydroFeatureById,
    hydroVisibilityThreshold,
    isCountryVisibleById,
    isHydroFeatureVisible,
    isLayerItemVisible,
    isMobile,
    isSafeKoreanErrorMessage,
    mapTheme,
    mapWorkScheduler,
    prepareHydroFeature,
    queueMapResize,
    renderPendingCountryOverlays,
    renderViewFrame,
    reportOperationError,
    runtimeAssetUrl,
    scheduleGpuMeshRebuild,
    scheduleViewRender,
    setActionStatus,
    state,
  } = deps;
  return (() => {
    const PI = Math.PI;
    let canvas = null;
    let gl = null;
    let glVersion = 0;
    let webGlContextKind = '';
    let uintIndexExtension = null;
    let ctx2d = null;
    let rendererMode = 'pending';
    let fillProgram = null;
    let landMaskProgram = null;
    let lineProgram = null;
    let pickProgram = null;
    let terrainProgram = null;
    let hydroFillProgram = null;
    let hydroLineProgram = null;
    let hydroPickProgram = null;
    let hydroLinePickProgram = null;
    let hydroCornerBuffer = null;
    let instancedExtension = null;
    let hydroVisibilityTexture = null;
    let hydroVisibilityWidth = 1;
    let hydroVisibilityHeight = 1;
    let hydroManifest = null;
    let hydroManifestUrl = null;
    let hydroWorker = null;
    let hydroWorkerReady = false;
    let hydroViewKey = '';
    let hydroRequestRevision = 0;
    let hydroAcceptedRevision = 0;
    let hydroActivePackIds = new Set();
    const hydroPacks = new Map();
    const hydroUploadQueue = [];
    let hydroUploadFrame = 0;
    let hydroVisibilityDirty = true;
    const hydroFeatureRequests = new Map();
    let hydroFeatureRequestId = 0;
    let hydroCacheCompletionNotified = false;
    let fillVao = null;
    let lineVao = null;
    let positionBuffer = null;
    let countryBuffer = null;
    let fillIndexBuffer = null;
    let lineIndexBuffer = null;
    let paletteTexture = null;
    let overridePaletteTexture = null;
    let overridePositionBuffer = null;
    let overrideCountryBuffer = null;
    let overrideFillIndexBuffer = null;
    let overrideLineIndexBuffer = null;
    let overrideFillVao = null;
    let overrideLineVao = null;
    let overrideMesh = null;
    let overrideWebGl1PositionData = null;
    let overrideWebGl1CountryData = null;
    const countryOverrideIds = new Set();
    const overrideFeatureSnapshots = new Map();
    const geometryRevisionTracker = createCountryGeometryRevisionTracker();
    let pendingOldMeshVisibleCount = 0;
    let patchWorker = null;
    const patchRequests = new Map();
    let terrainManifest = null;
    const terrainTiles = new Map();
    const terrainTileRequests = new Map();
    const terrainFetchQueue = [];
    const terrainFetchQueuedKeys = new Set();
    let terrainActiveFetches = 0;
    const terrainTileFailures = new Map();
    const terrainTileQueuedKeys = new Set();
    const terrainUploadQueue = [];
    let terrainUploadFrame = 0;
    const terrainGridMeshes = new Map();
    let terrainLastLevel = -1;
    let terrainRenderedLevel = -1;
    let terrainTargetTileCount = 0;
    let terrainTargetTilesLoaded = 0;
    let mesh = null;
    let meshCountryIds = [];
    let meshQuality = 'preview';
    let canonicalMeshReady = false;
    let effectivePixelRatio = 1;
    let pixelWidth = 0;
    let pixelHeight = 0;
    let cssWidth = 0;
    let cssHeight = 0;
    let pickFramebuffer = null;
    let pickTexture = null;
    let worker = null;
    let workerCompletionResolver = null;
    let canvasWorker = null;
    let canvasWorkerUrl = null;
    let canvasWorkerBitmapContext = null;
    let canvasWorker2dContext = null;
    let canvasWorkerReady = false;
    let canvasWorkerBusy = false;
    let canvasWorkerPendingMessage = null;
    let canvasWorkerLatestRequestedRevision = 0;
    let canvasWorkerDisplayedRevision = 0;
    let canvasHydroPickRequestId = 0;
    const canvasHydroPickRequests = new Map();
    let fallbackReason = '';
    let layoutMismatchCount = 0;
    let layoutVerificationFrame = 0;
    let webglRecoveryTimer = 0;
    let webglContextLost = false;
    let currentRenderRevision = 0;
    let displayedRenderRevision = 0;
    let webGl1PositionData = null;
    let webGl1CountryData = null;
    const frameTimes = [];
    let canvasDataReplacementResolver = null;
    let lastGeometryCommitTimings = null;
    const forcedRenderer = (() => {
      try {
        const value = new URLSearchParams(location.search).get('renderer');
        return ['webgl2', 'webgl1', 'canvas'].includes(value) ? value : '';
      } catch (_) { return ''; }
    })();

    function resolveRenderPixelRatio() {
      effectivePixelRatio = resolveRenderPixelRatioValue(window.devicePixelRatio, isMobile());
      return effectivePixelRatio;
    }

    const vertexShaderSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      layout(location=0) in ivec2 aCoord;
      layout(location=1) in uint aCountry;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      out float vDepth;
      flat out uint vCountry;
      void main() {
        float lon = float(aCoord.x) * 0.000001 * ${Math.PI / 180};
        float lat = float(aCoord.y) * 0.000001 * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const fillFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uPalette;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        vec4 color = texelFetch(uPalette, ivec2(int(vCountry), 0), 0);
        if (color.a <= 0.0) discard;
        outColor = color;
      }`;
    const lineFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uPalette;
      uniform int uMode;
      uniform vec4 uBorderColor;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        if (texelFetch(uPalette, ivec2(int(vCountry), 0), 0).a <= 0.0) discard;
        outColor = uBorderColor;
      }`;
    const pickFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uPalette;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        if (texelFetch(uPalette, ivec2(int(vCountry), 0), 0).a <= 0.0) discard;
        uint id = vCountry + 1u;
        outColor = vec4(float(id & 255u), float((id >> 8u) & 255u), float((id >> 16u) & 255u), 255.0) / 255.0;
      }`;
    const landMaskFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        outColor = vec4(1.0);
      }`;
    const vertexShaderSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      attribute vec2 aCoord;
      attribute float aCountry;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      varying float vDepth;
      varying float vCountry;
      void main() {
        float lon = aCoord.x * 0.000001 * ${Math.PI / 180};
        float lat = aCoord.y * 0.000001 * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const hydroRibbonVertexSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      layout(location=0) in vec2 aCorner;
      layout(location=1) in ivec2 aStart;
      layout(location=2) in ivec2 aEnd;
      layout(location=3) in uint aCountry;
      layout(location=4) in float aStartWidth;
      layout(location=5) in float aEndWidth;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform float uWidthBoost;
      uniform float uWidthScale;
      uniform int uMode;
      out float vDepth;
      flat out uint vCountry;
      void projectCoord(ivec2 coord, out vec2 screenPoint, out float depth) {
        float lon = float(coord.x) * 0.000001 * ${Math.PI / 180};
        float lat = float(coord.y) * 0.000001 * ${Math.PI / 180};
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          depth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          depth = 1.0;
        }
      }
      void main() {
        vec2 startPoint;
        vec2 endPoint;
        float startDepth;
        float endDepth;
        projectCoord(aStart, startPoint, startDepth);
        projectCoord(aEnd, endPoint, endDepth);
        vec2 direction = endPoint - startPoint;
        float segmentLength = length(direction);
        direction = segmentLength > 0.0001 ? direction / segmentLength : vec2(1.0, 0.0);
        vec2 normal = vec2(-direction.y, direction.x);
        float width = mix(aStartWidth, aEndWidth, aCorner.x) * uWidthScale;
        vec2 screenPoint = mix(startPoint, endPoint, aCorner.x) + normal * aCorner.y * (width + uWidthBoost) * 0.5;
        vDepth = mix(startDepth, endDepth, aCorner.x);
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const hydroRibbonVertexSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      attribute vec2 aCorner;
      attribute vec2 aStart;
      attribute vec2 aEnd;
      attribute float aCountry;
      attribute float aStartWidth;
      attribute float aEndWidth;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform float uWidthBoost;
      uniform float uWidthScale;
      uniform int uMode;
      varying float vDepth;
      varying float vCountry;
      void projectCoord(vec2 coord, out vec2 screenPoint, out float depth) {
        float lon = coord.x * 0.000001 * ${Math.PI / 180};
        float lat = coord.y * 0.000001 * ${Math.PI / 180};
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          depth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          depth = 1.0;
        }
      }
      void main() {
        vec2 startPoint;
        vec2 endPoint;
        float startDepth;
        float endDepth;
        projectCoord(aStart, startPoint, startDepth);
        projectCoord(aEnd, endPoint, endDepth);
        vec2 direction = endPoint - startPoint;
        float segmentLength = length(direction);
        direction = segmentLength > 0.0001 ? direction / segmentLength : vec2(1.0, 0.0);
        vec2 normal = vec2(-direction.y, direction.x);
        float width = mix(aStartWidth, aEndWidth, aCorner.x) * uWidthScale;
        vec2 screenPoint = mix(startPoint, endPoint, aCorner.x) + normal * aCorner.y * (width + uWidthBoost) * 0.5;
        vDepth = mix(startDepth, endDepth, aCorner.x);
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const fillFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float index = floor(vCountry + 0.5);
        vec4 color = texture2D(uPalette, vec2((index + 0.5) / uPaletteWidth, 0.5));
        if (color.a <= 0.0) discard;
        gl_FragColor = color;
      }`;
    const lineFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      uniform int uMode;
      uniform vec4 uBorderColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float index = floor(vCountry + 0.5);
        if (texture2D(uPalette, vec2((index + 0.5) / uPaletteWidth, 0.5)).a <= 0.0) discard;
        gl_FragColor = uBorderColor;
      }`;
    const pickFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float index = floor(vCountry + 0.5);
        if (texture2D(uPalette, vec2((index + 0.5) / uPaletteWidth, 0.5)).a <= 0.0) discard;
        float id = floor(vCountry + 1.5);
        float r = mod(id, 256.0);
        float g = mod(floor(id / 256.0), 256.0);
        float b = mod(floor(id / 65536.0), 256.0);
        gl_FragColor = vec4(r, g, b, 255.0) / 255.0;
      }`;
    const landMaskFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        gl_FragColor = vec4(1.0);
      }`;
    const terrainVertexSourceWebGl2 = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 aGrid;
      uniform vec4 uGeoBounds;
      uniform vec4 uUvBounds;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      out vec2 vUv;
      out float vDepth;
      void main() {
        float lon = mix(uGeoBounds.x, uGeoBounds.z, aGrid.x) * ${Math.PI / 180};
        float lat = mix(uGeoBounds.y, uGeoBounds.w, aGrid.y) * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vUv = mix(uUvBounds.xy, uUvBounds.zw, aGrid);
      }`;
    const terrainFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in vec2 vUv;
      in float vDepth;
      uniform sampler2D uTerrain;
      uniform int uMode;
      uniform float uPhysicalStyle;
      uniform float uDarkTheme;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        vec4 terrainSample = texture(uTerrain, vUv);
        vec3 neutral = vec3(terrainSample.a);
        vec3 color = mix(neutral, terrainSample.rgb, uPhysicalStyle);
        color = mix(color, color * vec3(0.60, 0.68, 0.76), uDarkTheme * 0.48);
        outColor = vec4(color, 1.0);
      }`;
    const terrainVertexSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      attribute vec2 aGrid;
      uniform vec4 uGeoBounds;
      uniform vec4 uUvBounds;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        float lon = mix(uGeoBounds.x, uGeoBounds.z, aGrid.x) * ${Math.PI / 180};
        float lat = mix(uGeoBounds.y, uGeoBounds.w, aGrid.y) * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vUv = mix(uUvBounds.xy, uUvBounds.zw, aGrid);
      }`;
    const terrainFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying vec2 vUv;
      varying float vDepth;
      uniform sampler2D uTerrain;
      uniform int uMode;
      uniform float uPhysicalStyle;
      uniform float uDarkTheme;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        vec4 terrainSample = texture2D(uTerrain, vUv);
        vec3 neutral = vec3(terrainSample.a);
        vec3 color = mix(neutral, terrainSample.rgb, uPhysicalStyle);
        color = mix(color, color * vec3(0.60, 0.68, 0.76), uDarkTheme * 0.48);
        gl_FragColor = vec4(color, 1.0);
      }`;
    const hydroFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uHydroVisibility;
      uniform ivec2 uHydroVisibilitySize;
      uniform vec4 uHydroColor;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        int featureId = int(vCountry);
        ivec2 cell = ivec2(featureId % uHydroVisibilitySize.x, featureId / uHydroVisibilitySize.x);
        if (texelFetch(uHydroVisibility, cell, 0).a <= 0.0) discard;
        outColor = uHydroColor;
      }`;
    const hydroPickFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uHydroVisibility;
      uniform ivec2 uHydroVisibilitySize;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        int featureId = int(vCountry);
        ivec2 cell = ivec2(featureId % uHydroVisibilitySize.x, featureId / uHydroVisibilitySize.x);
        if (texelFetch(uHydroVisibility, cell, 0).a <= 0.0) discard;
        uint id = vCountry + 1u;
        outColor = vec4(float(id & 255u), float((id >> 8u) & 255u), float((id >> 16u) & 255u), 255.0) / 255.0;
      }`;
    const hydroFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uHydroVisibility;
      uniform vec2 uHydroVisibilitySize;
      uniform vec4 uHydroColor;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float featureId = floor(vCountry + 0.5);
        float x = mod(featureId, uHydroVisibilitySize.x);
        float y = floor(featureId / uHydroVisibilitySize.x);
        if (texture2D(uHydroVisibility, vec2((x + 0.5) / uHydroVisibilitySize.x, (y + 0.5) / uHydroVisibilitySize.y)).a <= 0.0) discard;
        gl_FragColor = uHydroColor;
      }`;
    const hydroPickFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uHydroVisibility;
      uniform vec2 uHydroVisibilitySize;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float featureId = floor(vCountry + 0.5);
        float x = mod(featureId, uHydroVisibilitySize.x);
        float y = floor(featureId / uHydroVisibilitySize.x);
        if (texture2D(uHydroVisibility, vec2((x + 0.5) / uHydroVisibilitySize.x, (y + 0.5) / uHydroVisibilitySize.y)).a <= 0.0) discard;
        float id = featureId + 1.0;
        gl_FragColor = vec4(mod(id, 256.0), mod(floor(id / 256.0), 256.0), mod(floor(id / 65536.0), 256.0), 255.0) / 255.0;
      }`;

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || 'shader compile failed';
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    }

    function createProgram(vertexSource, fragmentSource) {
      const program = gl.createProgram();
      const vertex = compileShader(gl.VERTEX_SHADER, vertexSource);
      const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) || 'program link failed';
        gl.deleteProgram(program);
        throw new Error(message);
      }
      return program;
    }

    function attach(nextCanvas) {
      canvas = nextCanvas;
      canvas.className = 'gpu-map-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      layoutMismatchCount = 0;
    }

    function replaceCanvas() {
      const replacement = document.createElement('canvas');
      canvas?.replaceWith(replacement);
      attach(replacement);
      gl = null;
      glVersion = 0;
      webGlContextKind = '';
      uintIndexExtension = null;
      instancedExtension = null;
      ctx2d = null;
      canvasWorkerBitmapContext = null;
      canvasWorker2dContext = null;
      return replacement;
    }

    function isWebGlRenderer() {
      return rendererMode === 'webgl2' || rendererMode === 'webgl1';
    }

    function connectHydroCanvasWorkers() {
      if (!hydroWorker || !canvasWorker || rendererMode !== 'canvas-worker' || typeof MessageChannel !== 'function') return;
      const channel = new MessageChannel();
      canvasWorker.postMessage({ type: 'hydro-port', port: channel.port1 }, [channel.port1]);
      hydroWorker.postMessage({ type: 'hydro-port', port: channel.port2 }, [channel.port2]);
    }

    function rendererName() {
      return glVersion === 2 ? 'WebGL2' : glVersion === 1 ? 'WebGL1' : 'Canvas';
    }

    function meshQualityLabel() {
      return canonicalMeshReady ? '무손실' : '빠른 미리보기';
    }

    function updateRendererStatus(label, reason = '') {
      const status = $('engineStatus');
      if (!status) return;
      status.textContent = reason ? `${label} · ${reason}` : label;
      status.title = status.textContent;
    }

    function createWebGlResources() {
      const vertexSource = glVersion === 2 ? vertexShaderSourceWebGl2 : vertexShaderSourceWebGl1;
      fillProgram = createProgram(vertexSource, glVersion === 2 ? fillFragmentSourceWebGl2 : fillFragmentSourceWebGl1);
      landMaskProgram = createProgram(vertexSource, glVersion === 2 ? landMaskFragmentSourceWebGl2 : landMaskFragmentSourceWebGl1);
      lineProgram = createProgram(vertexSource, glVersion === 2 ? lineFragmentSourceWebGl2 : lineFragmentSourceWebGl1);
      pickProgram = createProgram(vertexSource, glVersion === 2 ? pickFragmentSourceWebGl2 : pickFragmentSourceWebGl1);
      terrainProgram = createProgram(
        glVersion === 2 ? terrainVertexSourceWebGl2 : terrainVertexSourceWebGl1,
        glVersion === 2 ? terrainFragmentSourceWebGl2 : terrainFragmentSourceWebGl1,
      );
      hydroFillProgram = createProgram(vertexSource, glVersion === 2 ? hydroFragmentSourceWebGl2 : hydroFragmentSourceWebGl1);
      hydroLineProgram = createProgram(
        glVersion === 2 ? hydroRibbonVertexSourceWebGl2 : hydroRibbonVertexSourceWebGl1,
        glVersion === 2 ? hydroFragmentSourceWebGl2 : hydroFragmentSourceWebGl1,
      );
      hydroPickProgram = createProgram(vertexSource, glVersion === 2 ? hydroPickFragmentSourceWebGl2 : hydroPickFragmentSourceWebGl1);
      hydroLinePickProgram = createProgram(
        glVersion === 2 ? hydroRibbonVertexSourceWebGl2 : hydroRibbonVertexSourceWebGl1,
        glVersion === 2 ? hydroPickFragmentSourceWebGl2 : hydroPickFragmentSourceWebGl1,
      );
      paletteTexture = gl.createTexture();
      overridePaletteTexture = gl.createTexture();
      hydroVisibilityTexture = gl.createTexture();
      hydroCornerBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, hydroCornerBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      positionBuffer = gl.createBuffer();
      countryBuffer = gl.createBuffer();
      fillIndexBuffer = gl.createBuffer();
      lineIndexBuffer = gl.createBuffer();
      overridePositionBuffer = gl.createBuffer();
      overrideCountryBuffer = gl.createBuffer();
      overrideFillIndexBuffer = gl.createBuffer();
      overrideLineIndexBuffer = gl.createBuffer();
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      pickFramebuffer = null;
      pickTexture = null;
      for (const pending of terrainUploadQueue.splice(0)) pending.bitmap?.close?.();
      terrainTileQueuedKeys.clear();
      terrainTiles.clear();
      terrainTileRequests.clear();
      terrainFetchQueue.length = 0;
      terrainFetchQueuedKeys.clear();
      terrainActiveFetches = 0;
      terrainTileFailures.clear();
      terrainGridMeshes.clear();
      for (const entry of hydroPacks.values()) {
        entry.resources = null;
        entry.uploadState = null;
        entry.uploadQueued = false;
        scheduleHydroUpload(entry);
      }
      hydroVisibilityDirty = true;
    }

    function handleWebGlContextLost(event) {
      if (event.currentTarget !== canvas) return;
      event.preventDefault();
      webglContextLost = true;
      rendererMode = 'webgl-recovering';
      clearTimeout(webglRecoveryTimer);
      $('engineStatus').textContent = `${rendererName()} · 컨텍스트를 복구하는 중입니다.`;
      updateRendererStatus(`${rendererName()} · GPU를 복구하는 중입니다.`);
      setActionStatus('지도 GPU를 복구하는 중입니다.', 'working', 0);
      webglRecoveryTimer = setTimeout(() => {
        if (webglContextLost && rendererMode === 'webgl-recovering') {
          activateCanvasFallback('WebGL 컨텍스트 복구 시간 초과');
        }
      }, 5000);
    }

    function handleWebGlContextRestored(event) {
      if (event.currentTarget !== canvas || !webglContextLost) return;
      clearTimeout(webglRecoveryTimer);
      try {
        gl = canvas.getContext(webGlContextKind);
        if (!gl) throw new Error(`복구된 ${rendererName()} 컨텍스트를 가져올 수 없습니다.`);
        if (glVersion === 1) {
          uintIndexExtension = gl.getExtension('OES_element_index_uint');
          if (!uintIndexExtension) throw new Error('WebGL1 32비트 인덱스를 지원하지 않습니다.');
          instancedExtension = gl.getExtension('ANGLE_instanced_arrays');
          if (!instancedExtension) throw new Error('WebGL1 인스턴스 수계 렌더링을 지원하지 않습니다.');
        }
        createWebGlResources();
        webglContextLost = false;
        rendererMode = glVersion === 2 ? 'webgl2' : 'webgl1';
        if (mesh) setMesh(mesh, meshCountryIds);
        if (overrideMesh) setOverrideMesh(overrideMesh);
        else render(currentRenderRevision);
        $('engineStatus').textContent = `Natural Earth 5.1.1 · ${rendererName()} ${meshQualityLabel()}`;
        updateRendererStatus(`${rendererName()} · GPU 실시간`);
        setActionStatus('지도 GPU를 복구했습니다.', 'success', 2200);
      } catch (error) {
        webglContextLost = false;
        console.error('[PL-GPU-002]', error);
        activateCanvasFallback('WebGL 컨텍스트를 복구하지 못했습니다.');
      }
    }

    function initWebGl(version) {
      const contextKind = version === 2 ? 'webgl2' : 'webgl';
      webGlContextKind = contextKind;
      gl = canvas.getContext(contextKind, {
        alpha: true,
        antialias: true,
        depth: false,
        stencil: true,
        preserveDrawingBuffer: false,
        premultipliedAlpha: true,
        powerPreference: 'high-performance',
      });
      if (!gl && version === 1) {
        webGlContextKind = 'experimental-webgl';
        gl = canvas.getContext(webGlContextKind, { alpha: true, antialias: true, depth: false, stencil: true, preserveDrawingBuffer: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
      }
      if (!gl) throw new Error(`${version === 2 ? 'WebGL2' : 'WebGL1'}를 지원하지 않습니다.`);
      if (!gl.getContextAttributes()?.stencil) throw new Error(`${version === 2 ? 'WebGL2' : 'WebGL1'} 스텐실 마스크를 지원하지 않습니다.`);
      glVersion = version;
      uintIndexExtension = version === 1 ? gl.getExtension('OES_element_index_uint') : true;
      if (version === 1 && !uintIndexExtension) throw new Error('WebGL1 OES_element_index_uint를 지원하지 않습니다.');
      instancedExtension = version === 1 ? gl.getExtension('ANGLE_instanced_arrays') : true;
      if (version === 1 && !instancedExtension) throw new Error('WebGL1 ANGLE_instanced_arrays를 지원하지 않습니다.');
      createWebGlResources();
      canvas.addEventListener('webglcontextlost', handleWebGlContextLost);
      canvas.addEventListener('webglcontextrestored', handleWebGlContextRestored);
      webglContextLost = false;
      rendererMode = version === 2 ? 'webgl2' : 'webgl1';
    }

    function setMesh(nextMesh, countryIds, { renderFrame = true } = {}) {
      mesh = nextMesh;
      meshCountryIds = [...countryIds];
      webGl1PositionData = null;
      webGl1CountryData = null;
      if (!gl || !isWebGlRenderer()) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      if (glVersion === 2) {
        gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      } else {
        webGl1PositionData = new Float32Array(mesh.positions.length);
        for (let index = 0; index < mesh.positions.length; index += 1) webGl1PositionData[index] = mesh.positions[index];
        gl.bufferData(gl.ARRAY_BUFFER, webGl1PositionData, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, countryBuffer);
      if (glVersion === 2) {
        gl.bufferData(gl.ARRAY_BUFFER, mesh.countryIndices, gl.STATIC_DRAW);
      } else {
        webGl1CountryData = new Float32Array(mesh.countryIndices.length);
        for (let index = 0; index < mesh.countryIndices.length; index += 1) webGl1CountryData[index] = mesh.countryIndices[index];
        gl.bufferData(gl.ARRAY_BUFFER, webGl1CountryData, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fillIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.triangleIndices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.lineIndices, gl.STATIC_DRAW);

      fillVao = null;
      lineVao = null;
      if (glVersion === 2) {
        fillVao = gl.createVertexArray();
        gl.bindVertexArray(fillVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 2, gl.INT, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, countryBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fillIndexBuffer);

        lineVao = gl.createVertexArray();
        gl.bindVertexArray(lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 2, gl.INT, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, countryBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIndexBuffer);
        gl.bindVertexArray(null);
      }
      window.__PANDOLAB_GPU_METRICS__ = getStats();
      if (renderFrame) render(currentRenderRevision);
    }

    function setOverrideMesh(nextMesh, { renderFrame = true } = {}) {
      overrideMesh = nextMesh;
      overrideWebGl1PositionData = null;
      overrideWebGl1CountryData = null;
      if (!gl || !isWebGlRenderer() || !nextMesh) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, overridePositionBuffer);
      if (glVersion === 2) gl.bufferData(gl.ARRAY_BUFFER, nextMesh.positions, gl.DYNAMIC_DRAW);
      else {
        overrideWebGl1PositionData = Float32Array.from(nextMesh.positions);
        gl.bufferData(gl.ARRAY_BUFFER, overrideWebGl1PositionData, gl.DYNAMIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, overrideCountryBuffer);
      if (glVersion === 2) gl.bufferData(gl.ARRAY_BUFFER, nextMesh.countryIndices, gl.DYNAMIC_DRAW);
      else {
        overrideWebGl1CountryData = Float32Array.from(nextMesh.countryIndices);
        gl.bufferData(gl.ARRAY_BUFFER, overrideWebGl1CountryData, gl.DYNAMIC_DRAW);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, overrideFillIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, nextMesh.triangleIndices, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, overrideLineIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, nextMesh.lineIndices, gl.DYNAMIC_DRAW);
      overrideFillVao = null;
      overrideLineVao = null;
      if (glVersion === 2) {
        const createVao = indexBuffer => {
          const vao = gl.createVertexArray();
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, overridePositionBuffer);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribIPointer(0, 2, gl.INT, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, overrideCountryBuffer);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
          gl.bindVertexArray(null);
          return vao;
        };
        overrideFillVao = createVao(overrideFillIndexBuffer);
        overrideLineVao = createVao(overrideLineIndexBuffer);
      }
      updatePalette();
      if (renderFrame) render(currentRenderRevision);
    }

    function remapOverrideMesh(rawMesh, localIds) {
      const globalIndices = localIds.map(id => {
        const key = String(id);
        let index = meshCountryIds.indexOf(key);
        if (index < 0) {
          meshCountryIds.push(key);
          index = meshCountryIds.length - 1;
        }
        return index;
      });
      const local = new Uint16Array(rawMesh.countryIndices);
      const countryIndices = new Uint16Array(local.length);
      for (let index = 0; index < local.length; index += 1) countryIndices[index] = globalIndices[local[index]];
      return {
        positions: new Int32Array(rawMesh.positions),
        countryIndices,
        triangleIndices: new Uint32Array(rawMesh.triangleIndices),
        lineIndices: new Uint32Array(rawMesh.lineIndices),
      };
    }

    function settleStalePatchRequests() {
      for (const [token, request] of patchRequests) {
        if (geometryRevisionTracker.isCurrent(token, request.geometryRevision)) continue;
        patchRequests.delete(token);
        request.resolve(false);
      }
    }

    function completeGeometryDisplay(ids, geometryRevision, { renderFrame = true } = {}) {
      const cleared = geometryRevisionTracker.markDisplayed(ids, geometryRevision);
      if (renderFrame) {
        updatePalette();
        render(currentRenderRevision);
      }
      for (const id of cleared) state.pendingCountryRenderIds.delete(String(id));
      renderPendingCountryOverlays?.();
      if (lastGeometryCommitTimings && Number(geometryRevision) === geometryRevisionTracker.committedRevision()) {
        lastGeometryCommitTimings.gpuPatchDisplayedAt ||= performance.now();
        if (!geometryRevisionTracker.pendingIds().length) lastGeometryCommitTimings.overlayRemovedAt ||= performance.now();
      }
      window.__PANDOLAB_GPU_METRICS__ = getStats();
      return cleared;
    }

    function normalizeCountryPatchRequest(rawRequest) {
      if (rawRequest && !Array.isArray(rawRequest) && typeof rawRequest === 'object' && rawRequest.ids) {
        const ids = [...new Set([...(rawRequest.ids || [])].map(String).filter(Boolean))];
        const byId = new Map((rawRequest.features || []).map(feature => [
          String(feature?.properties?.editor_id || feature?.properties?.iso_a3 || ''),
          feature,
        ]).filter(([id]) => id));
        const removed = new Set((rawRequest.removedIds || []).map(String));
        return {
          ids,
          features: ids.filter(id => !removed.has(id) && byId.has(id)).map(id => byId.get(id)),
          removedIds: ids.filter(id => removed.has(id) || !byId.has(id)),
        };
      }
      const ids = [...new Set([...(rawRequest || [])].map(String).filter(Boolean))];
      const features = [];
      const removedIds = [];
      for (const id of ids) {
        const feature = countryFeatureById(id);
        if (feature && String(feature.properties?.editor_id || '') === id) features.push(feature);
        else removedIds.push(id);
      }
      return { ids, features, removedIds };
    }

    function ensurePatchWorker() {
      if (patchWorker) return patchWorker;
      patchWorker = new Worker(runtimeAssetUrl('workers/gpu-mesh-worker.js'), { name: 'pandolab-country-patch-mesh' });
      patchWorker.onmessage = event => {
        const token = Number(event.data?.token || 0);
        const request = patchRequests.get(token);
        if (!request) return;
        patchRequests.delete(token);
        if (!geometryRevisionTracker.isCurrent(token, request.geometryRevision)) {
          request.resolve(false);
          return;
        }
        if (!event.data?.ok) {
          request.reject(new Error(event.data?.message || '변경 국가 메시를 만들지 못했습니다.'));
          return;
        }
        lastGeometryCommitTimings && (lastGeometryCommitTimings.patchWorkerCompletedAt = performance.now());
        const next = event.data.mesh;
        setOverrideMesh(remapOverrideMesh(next, next.countryIds || []), { renderFrame: false });
        completeGeometryDisplay(request.snapshotIds, request.geometryRevision);
        if (countryOverrideIds.size > 48 || (overrideMesh?.countryIndices?.length || 0) > (mesh?.countryIndices?.length || 1) * 0.25) {
          mapWorkScheduler.scheduleIdle('country-mesh-compaction', compactCountryOverrides, 2000);
        }
        request.resolve(true);
      };
      patchWorker.onerror = event => {
        console.error('[PL-GPU-PATCH-001]', event.message || event);
        for (const request of patchRequests.values()) request.reject(new Error(event.message || '변경 국가 메시 Worker 오류'));
        patchRequests.clear();
        patchWorker?.terminate();
        patchWorker = null;
        scheduleGpuMeshRebuild(0);
      };
      return patchWorker;
    }

    function applyCountryPatch(rawRequest) {
      const { ids, features, removedIds } = normalizeCountryPatchRequest(rawRequest);
      if (!ids.length) return Promise.resolve(true);
      mapWorkScheduler.cancel('country-mesh-compaction');
      const commit = geometryRevisionTracker.beginCommit(ids);
      settleStalePatchRequests();
      lastGeometryCommitTimings = {
        geometryRevision: commit.revision,
        editCommitAt: performance.now(),
        baseHiddenAt: 0,
        optimisticOverlayShownAt: 0,
        patchWorkerRequestedAt: 0,
        patchWorkerCompletedAt: 0,
        gpuPatchDisplayedAt: 0,
        overlayRemovedAt: 0,
      };
      for (const id of ids) countryOverrideIds.add(id);
      for (const feature of features) {
        const id = String(feature?.properties?.editor_id || '');
        if (id) overrideFeatureSnapshots.set(id, deepClone(feature));
      }
      for (const id of removedIds) overrideFeatureSnapshots.delete(String(id));
      for (const id of ids) state.pendingCountryRenderIds.add(id);
      renderPendingCountryOverlays?.();
      lastGeometryCommitTimings.optimisticOverlayShownAt = performance.now();
      if (rendererMode === 'canvas-worker' && canvasWorker) {
        canvasWorker.postMessage({
          type: 'patch',
          features: features.map(deepClone),
          removedIds,
          ids,
          revision: currentRenderRevision,
          geometryRevision: commit.revision,
          taskToken: commit.token,
        });
        lastGeometryCommitTimings.patchWorkerRequestedAt = performance.now();
        renderViewFrame();
        lastGeometryCommitTimings.baseHiddenAt = performance.now();
        return Promise.resolve(true);
      }
      if (!isWebGlRenderer()) {
        renderViewFrame();
        lastGeometryCommitTimings.baseHiddenAt = performance.now();
        completeGeometryDisplay(ids, commit.revision, { renderFrame: false });
        return Promise.resolve(true);
      }
      updatePalette();
      renderViewFrame();
      lastGeometryCommitTimings.baseHiddenAt = performance.now();
      const patchFeatures = [...overrideFeatureSnapshots.values()].map(deepClone);
      const snapshotIds = [...countryOverrideIds];
      const token = commit.token;
      return new Promise((resolve, reject) => {
        requestAnimationFrame(() => {
          if (!geometryRevisionTracker.isCurrent(token, commit.revision)) {
            resolve(false);
            return;
          }
          let currentWorker;
          try { currentWorker = ensurePatchWorker(); }
          catch (error) { reject(error); return; }
          patchRequests.set(token, { resolve, reject, geometryRevision: commit.revision, snapshotIds });
          lastGeometryCommitTimings.patchWorkerRequestedAt = performance.now();
          currentWorker.postMessage({ token, geometryRevision: commit.revision, features: patchFeatures });
        });
      }).catch(error => {
        if (!geometryRevisionTracker.isCurrent(token, commit.revision)) return false;
        console.error('[PL-GPU-PATCH-002]', error);
        scheduleGpuMeshRebuild(0);
        return false;
      });
    }

    function compactCountryOverrides() {
      if (!countryOverrideIds.size) return;
      rebuildFromCountries(state.countriesData?.features || [], {
        geometryRevision: geometryRevisionTracker.committedRevision(),
        reason: 'compaction',
      });
    }

    function resetCountryGeometryVisualState({ renderFrame = false } = {}) {
      mapWorkScheduler.cancel('country-mesh-compaction');
      geometryRevisionTracker.reset();
      settleStalePatchRequests();
      worker?.terminate();
      worker = null;
      workerCompletionResolver?.(false);
      workerCompletionResolver = null;
      countryOverrideIds.clear();
      overrideFeatureSnapshots.clear();
      overrideMesh = null;
      state.pendingCountryRenderIds.clear();
      lastGeometryCommitTimings = null;
      if (renderFrame) {
        updatePalette();
        render(currentRenderRevision);
      }
      renderPendingCountryOverlays?.();
      window.__PANDOLAB_GPU_METRICS__ = getStats();
    }

    async function decodeBuiltInMesh(rawBuffer = null, features = null) {
      const buffer = rawBuffer || window.PANDOLAB_GPU_MESH_BUFFER;
      if (!(buffer instanceof ArrayBuffer)) throw new Error('외부 GPU 메시가 준비되지 않았습니다.');
      if (!rawBuffer) window.PANDOLAB_GPU_MESH_BUFFER = null;
      const header = new Uint32Array(buffer, 0, 8);
      if (header[0] !== 0x434d4731 || header[1] !== 1 || header[2] !== 258 || header[6] < 1 || header[7] !== 3) {
        throw new Error('외부 GPU 메시 형식 또는 알고리즘 리비전이 올바르지 않습니다.');
      }
      const countryCount = header[2];
      const vertexCount = header[3];
      const triangleIndexCount = header[4];
      const lineIndexCount = header[5];
      let offset = 8 * 4;
      const positions = new Int32Array(buffer, offset, vertexCount * 2);
      offset += positions.byteLength;
      const countryIndices = new Uint16Array(buffer, offset, vertexCount);
      offset += (countryIndices.byteLength + 3) & ~3;
      const triangleIndices = new Uint32Array(buffer, offset, triangleIndexCount);
      offset += triangleIndices.byteLength;
      const lineIndices = new Uint32Array(buffer, offset, lineIndexCount);
      const ids = (features || window.PANDOLAB_COUNTRIES?.features || []).slice(0, countryCount)
        .map((feature, index) => String(feature.properties?.editor_id || feature.properties?.iso_a3 || index));
      return { mesh: { positions, countryIndices, triangleIndices, lineIndices }, ids, sourceCoordinateCount: header[6], buffer };
    }

    function createWorker() {
      if (worker) {
        worker.terminate();
        workerCompletionResolver?.(false);
        workerCompletionResolver = null;
      }
      worker = new Worker(runtimeAssetUrl('workers/gpu-mesh-worker.js'), {
        name: 'pandolab-gpu-mesh',
      });
      return worker;
    }

    function rebuildFromCountries(features, {
      geometryRevision = geometryRevisionTracker.committedRevision(),
      reason = 'full-rebuild',
    } = {}) {
      const task = geometryRevisionTracker.beginTask(geometryRevision);
      settleStalePatchRequests();
      const pendingIds = geometryRevisionTracker.pendingIds();
      if (rendererMode === 'canvas-worker' && canvasWorker) {
        meshQuality = 'canonical';
        canonicalMeshReady = true;
        canvasWorker.postMessage({
          type: 'data', features, ids: pendingIds,
          revision: currentRenderRevision,
          geometryRevision: task.revision,
          taskToken: task.token,
          reason,
        });
        renderCanvasWorker(currentRenderRevision);
        return Promise.resolve(true);
      }
      if (!isWebGlRenderer()) {
        meshQuality = 'canonical';
        canonicalMeshReady = true;
        countryOverrideIds.clear();
        overrideFeatureSnapshots.clear();
        overrideMesh = null;
        renderViewFrame();
        completeGeometryDisplay(pendingIds, task.revision, { renderFrame: false });
        return Promise.resolve(true);
      }
      const token = task.token;
      let currentWorker;
      try { currentWorker = createWorker(); }
      catch (error) {
        console.error('[PL-GPU-001]', error);
        activateCanvasFallback('동적 지도 메시를 준비하지 못했습니다.');
        return Promise.resolve(false);
      }
      $('engineStatus').textContent = `${rendererName()} · 편집 메시를 계산하는 중입니다.`;
      return new Promise(resolve => {
        const settle = value => {
          if (workerCompletionResolver === settle) workerCompletionResolver = null;
          resolve(value);
        };
        workerCompletionResolver = settle;
        currentWorker.onmessage = event => {
          if (event.data?.token !== token || !geometryRevisionTracker.isCurrent(token, task.revision)) {
            currentWorker.terminate();
            settle(false);
            return;
          }
          currentWorker.terminate();
          if (worker === currentWorker) worker = null;
          if (!event.data?.ok) {
            console.error('[PL-GPU-003]', event.data?.message || event.data);
            activateCanvasFallback('동적 지도 메시를 준비하지 못했습니다.');
            settle(false);
            return;
          }
          const next = event.data.mesh;
          countryOverrideIds.clear();
          overrideFeatureSnapshots.clear();
          overrideMesh = null;
          setMesh({
            positions: new Int32Array(next.positions),
            countryIndices: new Uint16Array(next.countryIndices),
            triangleIndices: new Uint32Array(next.triangleIndices),
            lineIndices: new Uint32Array(next.lineIndices),
          }, next.countryIds || [], { renderFrame: false });
          completeGeometryDisplay(pendingIds, task.revision);
          meshQuality = 'canonical';
          canonicalMeshReady = true;
          $('engineStatus').textContent = `Natural Earth 5.1.1 · ${rendererName()} 무손실`;
          updateRendererStatus(`${rendererName()} · GPU 실시간`);
          settle(true);
        };
        currentWorker.onerror = event => {
          if (!geometryRevisionTracker.isCurrent(token, task.revision)) {
            settle(false);
            return;
          }
          console.error('[PL-GPU-004]', event.message || event);
          activateCanvasFallback('동적 지도 메시 Worker를 사용할 수 없습니다.');
          settle(false);
        };
        currentWorker.postMessage({ token, geometryRevision: task.revision, features });
      });
    }

    function parseColor(value) {
      const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
      if (!match) return parseColor(defaultCountryColor());
      const n = Number.parseInt(match[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function uploadPalette(texture, pixels) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const internalFormat = glVersion === 2 ? gl.RGBA8 : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, Math.max(1, meshCountryIds.length), 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }

    function updatePalette() {
      if (!gl || !meshCountryIds.length) return;
      const basePixels = new Uint8Array(meshCountryIds.length * 4);
      const overridePixels = new Uint8Array(meshCountryIds.length * 4);
      pendingOldMeshVisibleCount = 0;
      for (let index = 0; index < meshCountryIds.length; index += 1) {
        const id = meshCountryIds[index];
        const feature = countryFeatureById(id);
        const color = parseColor(feature ? countryColor(feature) : '#000000');
        for (const pixels of [basePixels, overridePixels]) {
          pixels[index * 4] = color[0];
          pixels[index * 4 + 1] = color[1];
          pixels[index * 4 + 2] = color[2];
        }
        const visible = feature && isCountryVisibleById(id) ? mapTheme().fillAlphaByte : 0;
        const overridden = countryOverrideIds.has(id);
        const pending = geometryRevisionTracker.isPending(id);
        basePixels[index * 4 + 3] = overridden ? 0 : visible;
        overridePixels[index * 4 + 3] = overridden && !pending ? visible : 0;
        if (pending && (basePixels[index * 4 + 3] || overridePixels[index * 4 + 3])) pendingOldMeshVisibleCount += 1;
      }
      uploadPalette(paletteTexture, basePixels);
      uploadPalette(overridePaletteTexture, overridePixels);
    }

    function rotationRows() {
      const projection = globeProjection;
      const translate = projection.translate();
      const scale = projection.scale();
      const basis = [[0, 0], [90, 0], [0, 90]].map(coord => projection(coord));
      const rowX = basis.map(point => (point[0] - translate[0]) / scale);
      const rowY = basis.map(point => (point[1] - translate[1]) / scale);
      const cross = [
        rowX[1] * rowY[2] - rowX[2] * rowY[1],
        rowX[2] * rowY[0] - rowX[0] * rowY[2],
        rowX[0] * rowY[1] - rowX[1] * rowY[0],
      ];
      const length = Math.hypot(...cross) || 1;
      const rowZ = cross.map(value => -value / length);
      return { rowX, rowY, rowZ, translate, scale };
    }

    function setViewUniforms(program, worldOffset = 0) {
      const mode = state.projection === 'globe' ? 0 : 1;
      const data = mode === 0
        ? rotationRows()
        : {
            rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1],
            translate: flatProjection.translate(), scale: flatProjection.scale(),
          };
      gl.uniform2f(gl.getUniformLocation(program, 'uViewport'), cssWidth, cssHeight);
      gl.uniform2f(gl.getUniformLocation(program, 'uTranslate'), data.translate[0], data.translate[1]);
      gl.uniform1f(gl.getUniformLocation(program, 'uScale'), data.scale);
      gl.uniform3fv(gl.getUniformLocation(program, 'uRowX'), data.rowX);
      gl.uniform3fv(gl.getUniformLocation(program, 'uRowY'), data.rowY);
      gl.uniform3fv(gl.getUniformLocation(program, 'uRowZ'), data.rowZ);
      gl.uniform2f(gl.getUniformLocation(program, 'uFlatCenter'), state.view.flatCenter[0] * PI / 180, state.view.flatCenter[1] * PI / 180);
      gl.uniform1f(gl.getUniformLocation(program, 'uWorldOffset'), worldOffset);
      gl.uniform1i(gl.getUniformLocation(program, 'uMode'), mode);
    }

    function resize() {
      if (!canvas) return;
      cssWidth = Math.max(1, state.size.width);
      cssHeight = Math.max(1, state.size.height);
      const dpr = resolveRenderPixelRatio();
      const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
      const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        pickFramebuffer = null;
        pickTexture = null;
      }
      pixelWidth = nextWidth;
      pixelHeight = nextHeight;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    }

    function layoutMismatch() {
      const mapElement = $('map');
      if (!canvas || !mapElement?.isConnected || !canvas.isConnected) return 0;
      const mapRect = mapElement.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return Math.max(
        Math.abs(mapRect.left - canvasRect.left),
        Math.abs(mapRect.top - canvasRect.top),
        Math.abs(mapRect.width - canvasRect.width),
        Math.abs(mapRect.height - canvasRect.height),
      );
    }

    function verifyLayout() {
      if (!canvas) return true;
      const mismatch = layoutMismatch();
      if (mismatch <= 0.5) {
        layoutMismatchCount = 0;
        return true;
      }
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      resize();
      if (layoutVerificationFrame) cancelAnimationFrame(layoutVerificationFrame);
      layoutVerificationFrame = requestAnimationFrame(() => {
        layoutVerificationFrame = 0;
        if (layoutMismatch() <= 0.5) {
          layoutMismatchCount = 0;
          render(currentRenderRevision);
          return;
        }
        layoutMismatchCount += 1;
        if (layoutMismatchCount <= 3) {
          queueMapResize();
          verifyLayout();
        } else {
          console.warn('지도 레이어 크기를 완전히 맞추지 못했습니다.', layoutMismatch());
          layoutMismatchCount = 0;
        }
      });
      return false;
    }

    function bindWebGl1Attributes(program, indexBuffer, resources = null) {
      const coordLocation = gl.getAttribLocation(program, 'aCoord');
      const countryLocation = gl.getAttribLocation(program, 'aCountry');
      gl.bindBuffer(gl.ARRAY_BUFFER, resources?.positionBuffer || positionBuffer);
      if (coordLocation >= 0) {
        gl.enableVertexAttribArray(coordLocation);
        gl.vertexAttribPointer(coordLocation, 2, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, resources?.countryBuffer || countryBuffer);
      if (countryLocation >= 0) {
        gl.enableVertexAttribArray(countryLocation);
        gl.vertexAttribPointer(countryLocation, 1, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      return [coordLocation, countryLocation];
    }

    function drawProgram(program, vao, indexBuffer, indexCount, primitive, resources = null, palette = paletteTexture) {
      gl.useProgram(program);
      if (program === fillProgram || program === lineProgram || program === pickProgram) {
        gl.uniform1i(gl.getUniformLocation(program, 'uPalette'), 0);
        const paletteWidthLocation = gl.getUniformLocation(program, 'uPaletteWidth');
        if (paletteWidthLocation) gl.uniform1f(paletteWidthLocation, Math.max(1, meshCountryIds.length));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, palette);
      }
      if (program === lineProgram) {
        const theme = mapTheme();
        gl.lineWidth(Math.max(1, Number(theme.borderWidth) || 1));
        gl.uniform4f(gl.getUniformLocation(program, 'uBorderColor'), theme.borderGpu[0], theme.borderGpu[1], theme.borderGpu[2], theme.borderAlpha);
      }
      const webGl1Locations = glVersion === 2 ? null : bindWebGl1Attributes(program, indexBuffer, resources);
      if (glVersion === 2) gl.bindVertexArray(vao);
      const offsets = state.projection === 'globe' ? [0] : [-2 * PI, 0, 2 * PI];
      for (const offset of offsets) {
        setViewUniforms(program, offset);
        gl.drawElements(primitive, indexCount, gl.UNSIGNED_INT, 0);
      }
      if (glVersion === 2) gl.bindVertexArray(null);
      else {
        for (const location of webGl1Locations) if (location >= 0) gl.disableVertexAttribArray(location);
      }
    }

    function uploadHydroPack(entry) {
      if (!gl || !isWebGlRenderer() || entry.resources) return;
      const meshData = entry.mesh;
      if (!entry.uploadState) {
        entry.uploadState = {
          resources: {
            riverSegmentCount: meshData.riverFeatureIds.length,
            borderRiverSegmentCount: meshData.borderRiverFeatureIds.length,
            lakeIndexCount: meshData.lakeIndices.length,
          },
          tasks: [
            ['riverStartBuffer', meshData.riverStarts, gl.ARRAY_BUFFER, true], ['riverEndBuffer', meshData.riverEnds, gl.ARRAY_BUFFER, true],
            ['riverFeatureBuffer', meshData.riverFeatureIds, gl.ARRAY_BUFFER, true], ['riverStartWidthBuffer', meshData.riverStartWidths, gl.ARRAY_BUFFER],
            ['riverEndWidthBuffer', meshData.riverEndWidths, gl.ARRAY_BUFFER], ['borderRiverStartBuffer', meshData.borderRiverStarts, gl.ARRAY_BUFFER, true],
            ['borderRiverEndBuffer', meshData.borderRiverEnds, gl.ARRAY_BUFFER, true], ['borderRiverFeatureBuffer', meshData.borderRiverFeatureIds, gl.ARRAY_BUFFER, true],
            ['borderRiverStartWidthBuffer', meshData.borderRiverStartWidths, gl.ARRAY_BUFFER], ['borderRiverEndWidthBuffer', meshData.borderRiverEndWidths, gl.ARRAY_BUFFER],
            ['lakePositionBuffer', meshData.lakePositions, gl.ARRAY_BUFFER, true], ['lakeFeatureBuffer', meshData.lakeFeatureIds, gl.ARRAY_BUFFER, true],
            ['lakeIndexBuffer', meshData.lakeIndices, gl.ELEMENT_ARRAY_BUFFER],
          ].map(([key, data, target, webGl1Float]) => ({ key, data, target, webGl1Float, offset: 0, buffer: null })),
        };
      }
      const task = entry.uploadState.tasks[0];
      if (task) {
        const convertToFloat = task.webGl1Float && glVersion === 1 && !(task.data instanceof Float32Array);
        const outputBytes = convertToFloat ? task.data.length * 4 : task.data.byteLength;
        if (!task.buffer) {
          task.buffer = gl.createBuffer();
          gl.bindBuffer(task.target, task.buffer);
          gl.bufferData(task.target, outputBytes, gl.STATIC_DRAW);
          entry.uploadState.resources[task.key] = task.buffer;
        } else {
          gl.bindBuffer(task.target, task.buffer);
        }
        const byteBudget = 2 * 1024 * 1024;
        if (convertToFloat) {
          const start = Math.floor(task.offset / 4);
          const count = Math.min(task.data.length - start, Math.floor(byteBudget / 4));
          const chunk = Float32Array.from(task.data.subarray(start, start + count));
          gl.bufferSubData(task.target, task.offset, chunk);
          task.offset += chunk.byteLength;
        } else {
          const count = Math.min(outputBytes - task.offset, byteBudget);
          const chunk = new Uint8Array(task.data.buffer, task.data.byteOffset + task.offset, count);
          gl.bufferSubData(task.target, task.offset, chunk);
          task.offset += count;
        }
        if (task.offset >= outputBytes) entry.uploadState.tasks.shift();
      }
      if (!entry.uploadState.tasks.length) {
        entry.resources = entry.uploadState.resources;
        entry.uploadState = null;
      }
    }

    function deleteHydroPackResources(entry) {
      if (!entry || !gl) return;
      if (entry.uploadState?.resources) {
        for (const buffer of Object.values(entry.uploadState.resources)) {
          if (buffer && gl.isBuffer(buffer)) gl.deleteBuffer(buffer);
        }
      }
      entry.uploadState = null;
      if (!entry.resources) return;
      for (const key of [
        'riverStartBuffer', 'riverEndBuffer', 'riverFeatureBuffer', 'riverStartWidthBuffer', 'riverEndWidthBuffer',
        'borderRiverStartBuffer', 'borderRiverEndBuffer', 'borderRiverFeatureBuffer', 'borderRiverStartWidthBuffer', 'borderRiverEndWidthBuffer',
        'lakePositionBuffer', 'lakeFeatureBuffer', 'lakeIndexBuffer',
      ]) {
        if (entry.resources[key]) gl.deleteBuffer(entry.resources[key]);
      }
      entry.resources = null;
    }

    function updateHydroVisibility() {
      if (!gl || !hydroVisibilityTexture || !hydroManifest || !hydroVisibilityDirty) return;
      const count = Math.max(1, Number(hydroManifest.stats?.featureCount || 1));
      hydroVisibilityWidth = Math.min(4096, Math.max(1, count));
      hydroVisibilityHeight = Math.ceil(count / hydroVisibilityWidth);
      const pixels = new Uint8Array(hydroVisibilityWidth * hydroVisibilityHeight * 4);
      for (const [fidValue, feature] of state.hydroFeatureByFid?.entries?.() || []) {
        const fid = Number(fidValue);
        if (!Number.isInteger(fid) || fid < 0 || fid >= count || !isHydroFeatureVisible(feature)) continue;
        const offset = fid * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = pixels[offset + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, hydroVisibilityTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const internalFormat = glVersion === 2 ? gl.RGBA8 : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, hydroVisibilityWidth, hydroVisibilityHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      hydroVisibilityDirty = false;
    }

    function bindLakeAttributes(program, resources) {
      const coordLocation = glVersion === 2 ? 0 : gl.getAttribLocation(program, 'aCoord');
      const featureLocation = glVersion === 2 ? 1 : gl.getAttribLocation(program, 'aCountry');
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.lakePositionBuffer);
      gl.enableVertexAttribArray(coordLocation);
      if (glVersion === 2) gl.vertexAttribIPointer(coordLocation, 2, gl.INT, 0, 0);
      else gl.vertexAttribPointer(coordLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.lakeFeatureBuffer);
      gl.enableVertexAttribArray(featureLocation);
      if (glVersion === 2) gl.vertexAttribIPointer(featureLocation, 1, gl.UNSIGNED_INT, 0, 0);
      else gl.vertexAttribPointer(featureLocation, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.lakeIndexBuffer);
      return [coordLocation, featureLocation];
    }

    function setHydroUniforms(program, color) {
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, hydroVisibilityTexture);
      gl.uniform1i(gl.getUniformLocation(program, 'uHydroVisibility'), 2);
      const sizeLocation = gl.getUniformLocation(program, 'uHydroVisibilitySize');
      if (glVersion === 2) gl.uniform2i(sizeLocation, hydroVisibilityWidth, hydroVisibilityHeight);
      else gl.uniform2f(sizeLocation, hydroVisibilityWidth, hydroVisibilityHeight);
      const colorLocation = gl.getUniformLocation(program, 'uHydroColor');
      if (colorLocation && color) gl.uniform4fv(colorLocation, color);
    }

    function setInstanceDivisor(location, divisor) {
      if (glVersion === 2) gl.vertexAttribDivisor(location, divisor);
      else instancedExtension.vertexAttribDivisorANGLE(location, divisor);
    }

    function bindRiverAttributes(program, resources, borderAligned = false) {
      const locations = glVersion === 2 ? [0, 1, 2, 3, 4, 5] : [
        gl.getAttribLocation(program, 'aCorner'), gl.getAttribLocation(program, 'aStart'),
        gl.getAttribLocation(program, 'aEnd'), gl.getAttribLocation(program, 'aCountry'),
        gl.getAttribLocation(program, 'aStartWidth'), gl.getAttribLocation(program, 'aEndWidth'),
      ];
      const [corner, start, end, feature, startWidth, endWidth] = locations;
      const prefix = borderAligned ? 'borderRiver' : 'river';
      gl.bindBuffer(gl.ARRAY_BUFFER, hydroCornerBuffer);
      gl.enableVertexAttribArray(corner);
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}StartBuffer`]);
      gl.enableVertexAttribArray(start);
      if (glVersion === 2) gl.vertexAttribIPointer(start, 2, gl.INT, 0, 0);
      else gl.vertexAttribPointer(start, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}EndBuffer`]);
      gl.enableVertexAttribArray(end);
      if (glVersion === 2) gl.vertexAttribIPointer(end, 2, gl.INT, 0, 0);
      else gl.vertexAttribPointer(end, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}FeatureBuffer`]);
      gl.enableVertexAttribArray(feature);
      if (glVersion === 2) gl.vertexAttribIPointer(feature, 1, gl.UNSIGNED_INT, 0, 0);
      else gl.vertexAttribPointer(feature, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}StartWidthBuffer`]);
      gl.enableVertexAttribArray(startWidth);
      gl.vertexAttribPointer(startWidth, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}EndWidthBuffer`]);
      gl.enableVertexAttribArray(endWidth);
      gl.vertexAttribPointer(endWidth, 1, gl.FLOAT, false, 0, 0);
      setInstanceDivisor(corner, 0);
      for (const location of [start, end, feature, startWidth, endWidth]) setInstanceDivisor(location, 1);
      return locations;
    }

    function drawHydroEntry(program, entry, category, color = null, picking = false) {
      const resources = entry.resources;
      if (!resources) return;
      const borderAligned = category === 'border-river';
      const count = category === 'lake'
        ? resources.lakeIndexCount
        : (borderAligned ? resources.borderRiverSegmentCount : resources.riverSegmentCount);
      if (!count) return;
      setHydroUniforms(program, color);
      const locations = category === 'lake' ? bindLakeAttributes(program, resources) : bindRiverAttributes(program, resources, borderAligned);
      const widthBoostLocation = gl.getUniformLocation(program, 'uWidthBoost');
      if (widthBoostLocation) gl.uniform1f(widthBoostLocation, picking ? 6 : 0);
      const widthScaleLocation = gl.getUniformLocation(program, 'uWidthScale');
      if (widthScaleLocation) gl.uniform1f(widthScaleLocation, Math.max(0.5, Number(mapTheme().hydroBoundaryWidth) || 1));
      const offsets = state.projection === 'globe' ? [0] : [-2 * PI, 0, 2 * PI];
      for (const offset of offsets) {
        setViewUniforms(program, offset);
        if (category === 'lake') gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
        else if (glVersion === 2) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        else instancedExtension.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count);
      }
      if (category !== 'lake') for (const location of locations.slice(1)) setInstanceDivisor(location, 0);
      for (const location of locations) gl.disableVertexAttribArray(location);
      entry.lastUsed = performance.now();
    }

    function scheduleHydroUpload(entry) {
      if (!entry || entry.resources || entry.uploadQueued) return;
      entry.uploadQueued = true;
      hydroUploadQueue.push(entry);
      if (hydroUploadFrame) return;
      const drain = () => {
        hydroUploadFrame = 0;
        const next = hydroUploadQueue.shift();
        if (next) {
          next.uploadQueued = false;
          uploadHydroPack(next);
          if (next.resources) render(currentRenderRevision);
          else scheduleHydroUpload(next);
        }
        if (hydroUploadQueue.length) {
          hydroUploadFrame = requestAnimationFrame(drain);
        }
      };
      hydroUploadFrame = requestAnimationFrame(drain);
    }

    function drawHydro(category, picking = false) {
      if (!hydroManifest || !hydroActivePackIds.size || !state.layerVisibility.drawings) return;
      const theme = mapTheme();
      if (Number(theme.hydroOpacity) <= 0 || (category !== 'lake' && theme.hydroBoundaryVisible === false)) return;
      updateHydroVisibility();
      const program = category === 'river' || category === 'border-river'
        ? (picking ? hydroLinePickProgram : hydroLineProgram)
        : (picking ? hydroPickProgram : hydroFillProgram);
      const rgb = hydroDisplayColor(category === 'lake' ? 'lake' : 'river', true);
      const color = [...rgb, (category === 'lake' ? 0.92 : 0.96) * Math.max(0, Math.min(1, Number(theme.hydroOpacity) || 0))];
      for (const packId of hydroActivePackIds) {
        const entry = hydroPacks.get(packId);
        if (entry) drawHydroEntry(program, entry, category, color, picking);
      }
    }

    function hydroVisibleTileSpecs() {
      if (!hydroManifest?.stages?.length) return [];
      const threshold = hydroVisibilityThreshold();
      const flatScale = Math.max(1, flatProjection.scale());
      const flatHalfLon = state.size.width / flatScale * 90 / Math.PI + 2;
      const flatHalfLat = state.size.height / flatScale * 90 / Math.PI + 2;
      const flatCenter = state.view.flatCenter || [0, 0];
      const globeCenter = [-Number(state.view.globeRotation?.[0] || 0), -Number(state.view.globeRotation?.[1] || 0)];
      const globeRadius = Math.asin(Math.min(1, Math.hypot(state.size.width, state.size.height) * 0.5 / Math.max(1, globeProjection.scale())));
      const specs = [];
      for (const stage of hydroManifest.stages) {
        if (Number(stage.minZoom) > threshold + 1e-9) continue;
        const tileLon = 360 / stage.columns;
        const tileLat = 180 / stage.rows;
        for (let y = 0; y < stage.rows; y += 1) {
          const centerLat = 90 - (y + 0.5) * tileLat;
          for (let x = 0; x < stage.columns; x += 1) {
            const centerLon = -180 + (x + 0.5) * tileLon;
            let visible;
            if (state.projection === 'flat') {
              const deltaLon = Math.abs((((centerLon - flatCenter[0]) + 540) % 360) - 180);
              visible = deltaLon <= flatHalfLon + tileLon / 2 && Math.abs(centerLat - flatCenter[1]) <= flatHalfLat + tileLat / 2;
            } else {
              const tileRadius = Math.hypot(tileLon, tileLat) * Math.PI / 360;
              visible = d3.geo.distance(globeCenter, [centerLon, centerLat]) <= globeRadius + tileRadius + 0.04;
            }
            if (visible) specs.push({ stage: Number(stage.id), x, y });
          }
        }
      }
      return specs;
    }

    function requestHydroView() {
      if (!hydroWorker || !hydroWorkerReady || !hydroManifest) return;
      const tiles = hydroVisibleTileSpecs();
      const key = tiles.map(spec => `${spec.stage}/${spec.x}-${spec.y}`).join('|');
      if (key === hydroViewKey) return;
      hydroViewKey = key;
      const message = { type: 'view', revision: ++hydroRequestRevision, tiles, mobile: isMobile() };
      hydroWorker.postMessage(message);
    }

    let hydroRenderFrame = 0;
    function queueHydroRender() {
      if (hydroRenderFrame) return;
      hydroRenderFrame = requestAnimationFrame(() => {
        hydroRenderFrame = 0;
        render(currentRenderRevision);
      });
    }

    function registerHydroDescriptors(descriptors) {
      const logicalIds = new Set();
      for (const row of descriptors || []) {
        const logicalId = String(row.awId || row.logicalFid);
        let aggregate = state.hydroFeatureCache.get(logicalId);
        if (!aggregate) {
          aggregate = {
            type: 'Feature', id: logicalId, geometry: null,
            properties: {
              pandolab_id: logicalId, __logicalFid: Number(row.logicalFid),
              category: row.category, layer_id: row.layerId,
              name: row.name || '', name_ko: row.name || '', source: row.source || '',
              system_id: row.systemId || '', mainstem_name_ko: row.mainstemNameKo || row.name || '', role: row.role || '',
              source_id: row.sourceId || '', fragment_count: Number(row.fragmentCount || 1),
              min_zoom: Number(row.minZoom ?? 99), stroke_width: Number(row.width || 1), pack_ids: [],
            },
            __awBounds: [Infinity, Infinity, -Infinity, -Infinity],
          };
        }
        aggregate.properties.pack_ids = [...new Set([...(aggregate.properties.pack_ids || []), Number(row.packId)])];
        aggregate.properties.min_zoom = Math.min(Number(aggregate.properties.min_zoom ?? 99), Number(row.minZoom ?? 99));
        const bounds = (row.bounds || []).map(value => Number(value) / 1e6);
        if (bounds.length === 4) {
          aggregate.__awBounds = [
            Math.min(aggregate.__awBounds[0], bounds[0]), Math.min(aggregate.__awBounds[1], bounds[1]),
            Math.max(aggregate.__awBounds[2], bounds[2]), Math.max(aggregate.__awBounds[3], bounds[3]),
          ];
        }
        const b = aggregate.__awBounds;
        aggregate.__awCentroid = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        aggregate.__awRadius = Math.min(180, Math.hypot(b[2] - b[0], b[3] - b[1]) / 2);
        state.hydroFeatureCache.set(logicalId, aggregate);
        state.hydroFeatureByFid.set(Number(row.fid), aggregate);
        logicalIds.add(logicalId);
      }
      if (logicalIds.size) hydroVisibilityDirty = true;
    }

    function aggregateHydroLogicalFeature(logicalId) {
      const fragments = state.hydroFragmentsByLogicalId.get(logicalId);
      if (!fragments?.size) {
        state.hydroFragmentsByLogicalId.delete(logicalId);
        state.hydroFeatureCache.delete(logicalId);
        return null;
      }
      const ordered = [...fragments.values()].sort((left, right) => (
        Number(left.properties?.fragment_index || 0) - Number(right.properties?.fragment_index || 0)
      ));
      const first = ordered[0];
      let aggregate = first;
      if (first.properties?.category === 'river') {
        const parts = ordered.flatMap(feature => feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry?.coordinates || []);
        const widths = ordered.flatMap(feature => feature.properties?.stroke_widths || []);
        const sourceIds = [...new Set(ordered.flatMap(feature => String(feature.properties?.source_id || '').split(',').filter(Boolean)))];
        aggregate = {
          type: 'Feature', id: logicalId,
          properties: {
            ...first.properties,
            source_id: sourceIds.join(','),
            stroke_widths: widths,
            pack_ids: [...new Set(ordered.map(feature => Number(feature.properties?.pack_id)))],
            fragment_count: Math.max(...ordered.map(feature => Number(feature.properties?.fragment_count || 1))),
            loaded_fragment_count: ordered.length,
            min_zoom: Math.min(...ordered.map(feature => Number(feature.properties?.min_zoom ?? 99))),
          },
          geometry: parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts },
        };
      }
      prepareHydroFeature(aggregate);
      state.hydroFeatureCache.set(logicalId, aggregate);
      for (const fragment of ordered) state.hydroFeatureByFid.set(Number(fragment.properties?.__fid), aggregate);
      const sourceIds = new Set(String(aggregate.properties?.source_id || '').split(',').filter(Boolean));
      const legacyHidden = Object.keys(state.physicalSettings.hiddenHydroIds || {}).find(id => (
        state.physicalSettings.hiddenHydroIds[id] === true && id !== logicalId && sourceIds.has(String(id).split(':').pop())
      ));
      if (legacyHidden) state.physicalSettings.hiddenHydroIds[logicalId] = true;
      return aggregate;
    }

    function registerHydroFragments(features) {
      const logicalIds = new Set();
      for (const fragment of features) {
        const logicalId = String(fragment.properties?.pandolab_id || fragment.id);
        if (!state.hydroFragmentsByLogicalId.has(logicalId)) state.hydroFragmentsByLogicalId.set(logicalId, new Map());
        state.hydroFragmentsByLogicalId.get(logicalId).set(Number(fragment.properties?.__fid), fragment);
        logicalIds.add(logicalId);
      }
      for (const logicalId of logicalIds) aggregateHydroLogicalFeature(logicalId);
      if (logicalIds.size) hydroVisibilityDirty = true;
    }

    function unregisterHydroFragments(features) {
      const logicalIds = new Set();
      for (const fragment of features || []) {
        const logicalId = String(fragment.properties?.pandolab_id || fragment.id);
        state.hydroFragmentsByLogicalId.get(logicalId)?.delete(Number(fragment.properties?.__fid));
        state.hydroFeatureByFid.delete(Number(fragment.properties?.__fid));
        logicalIds.add(logicalId);
      }
      for (const logicalId of logicalIds) aggregateHydroLogicalFeature(logicalId);
      if (logicalIds.size) hydroVisibilityDirty = true;
    }

    function loadHydroLogicalFeature(logicalFid) {
      if (!hydroWorker || !hydroWorkerReady) return Promise.reject(new Error('수계 로더가 준비되지 않았습니다.'));
      const requestId = ++hydroFeatureRequestId;
      return new Promise((resolve, reject) => {
        hydroFeatureRequests.set(requestId, { resolve, reject });
        hydroWorker.postMessage({ type: 'load-feature', requestId, logicalFid });
      });
    }

    function retryHydroCache() {
      hydroWorker?.postMessage({ type: 'retry-cache' });
    }

    function receiveHydroWorkerMessage(event) {
      const message = event.data || {};
      if (message.type === 'ready') {
        hydroWorkerReady = true;
        hydroViewKey = '';
        requestHydroView();
        return;
      }
      if (message.type === 'active') {
        if (Number(message.revision || 0) < hydroAcceptedRevision) return;
        hydroAcceptedRevision = Number(message.revision || hydroAcceptedRevision);
        hydroActivePackIds = new Set(message.packIds || []);
        pruneHydroCache();
        queueHydroRender();
        return;
      }
      if (message.type === 'pack') {
        if (Number(message.revision || 0) < hydroAcceptedRevision) return;
        const meshData = message.mesh || {};
        const features = message.features || [];
        const descriptors = message.descriptors || [];
        const entry = {
          id: Number(message.packId), features, descriptors, resources: null, uploadQueued: false, lastUsed: performance.now(),
          mesh: {
            riverStarts: new Int32Array(meshData.riverStarts || 0),
            riverEnds: new Int32Array(meshData.riverEnds || 0),
            riverFeatureIds: new Uint32Array(meshData.riverFeatureIds || 0),
            riverStartWidths: new Float32Array(meshData.riverStartWidths || 0),
            riverEndWidths: new Float32Array(meshData.riverEndWidths || 0),
            borderRiverStarts: new Int32Array(meshData.borderRiverStarts || 0),
            borderRiverEnds: new Int32Array(meshData.borderRiverEnds || 0),
            borderRiverFeatureIds: new Uint32Array(meshData.borderRiverFeatureIds || 0),
            borderRiverStartWidths: new Float32Array(meshData.borderRiverStartWidths || 0),
            borderRiverEndWidths: new Float32Array(meshData.borderRiverEndWidths || 0),
            lakePositions: new Int32Array(meshData.lakePositions || 0),
            lakeFeatureIds: new Uint32Array(meshData.lakeFeatureIds || 0),
            lakeIndices: new Uint32Array(meshData.lakeIndices || 0),
          },
        };
        entry.byteLength = Object.values(entry.mesh).reduce((sum, value) => sum + value.byteLength, 0);
        hydroPacks.set(entry.id, entry);
        if (features.length) registerHydroFragments(features);
        else registerHydroDescriptors(descriptors);
        if (isWebGlRenderer()) scheduleHydroUpload(entry);
        pruneHydroCache();
        return;
      }
      if (message.type === 'feature' || message.type === 'feature-error') {
        const pending = hydroFeatureRequests.get(Number(message.requestId));
        if (!pending) return;
        hydroFeatureRequests.delete(Number(message.requestId));
        if (message.type === 'feature-error') pending.reject(new Error(message.message || '수계 전체 형상을 불러오지 못했습니다.'));
        else pending.resolve(message.feature ? prepareHydroFeature(message.feature) : null);
        return;
      }
      if (message.type === 'cache-progress') {
        state.physicalLoadState.hydroCache = 'loading';
        state.physicalLoadState.hydroCachePercent = Number(message.percent || 0);
        return;
      }
      if (message.type === 'cache-complete') {
        state.physicalLoadState.hydroCache = 'ready';
        state.physicalLoadState.hydroCachePercent = 100;
        if (!hydroCacheCompletionNotified) {
          hydroCacheCompletionNotified = true;
          setActionStatus('전 세계 수계 데이터를 오프라인 저장소에 준비했습니다.', 'success', 3200);
        }
        return;
      }
      if (message.type === 'cache-unavailable') {
        state.physicalLoadState.hydroCache = 'error';
        console.warn('Hydro persistent cache unavailable', message.message);
        setActionStatus('전 세계 수계 자료를 오프라인 저장소에 준비하지 못했습니다. 현재 화면은 계속 사용할 수 있으며, 강 또는 호수 레이어를 선택하면 다시 시도합니다.', 'error', 0);
        return;
      }
      if (message.type === 'error') {
        console.warn('Hydro tile worker failed', message.message);
        reportOperationError(new Error(message.message || ''), '현재 화면의 수계 데이터를 불러오지 못했습니다. 지도를 조금 이동하거나 다시 시도하세요.', 'PL-WATER-003', 0);
      }
    }

    function pruneHydroCache() {
      const limit = (isMobile() ? 48 : 96) * 1024 * 1024;
      let total = [...hydroPacks.values()].reduce((sum, entry) => sum + entry.byteLength, 0);
      if (total <= limit) return;
      const selectedFeature = state.selected?.type === 'hydro' ? hydroFeatureById(state.selected.id) : null;
      const selectedPacks = new Set(selectedFeature?.properties?.pack_ids || [selectedFeature?.properties?.pack_id].filter(Number.isFinite));
      const candidates = [...hydroPacks.values()]
        .filter(entry => !hydroActivePackIds.has(entry.id) && !selectedPacks.has(entry.id))
        .sort((left, right) => left.lastUsed - right.lastUsed);
      const released = [];
      for (const entry of candidates) {
        if (total <= limit) break;
        deleteHydroPackResources(entry);
        hydroPacks.delete(entry.id);
        unregisterHydroFragments(entry.features);
        total -= entry.byteLength;
        released.push(entry.id);
      }
      if (released.length) hydroWorker?.postMessage({ type: 'release', packIds: released });
    }

    function setHydroManifest(nextManifest, sourceUrl) {
      hydroManifest = nextManifest?.stages?.length ? nextManifest : null;
      hydroManifestUrl = sourceUrl ? new URL(sourceUrl) : null;
      hydroWorker?.terminate();
      hydroWorker = null;
      hydroWorkerReady = false;
      hydroViewKey = '';
      hydroAcceptedRevision = 0;
      hydroActivePackIds.clear();
      hydroUploadQueue.length = 0;
      if (hydroUploadFrame) cancelAnimationFrame(hydroUploadFrame);
      hydroUploadFrame = 0;
      hydroVisibilityDirty = true;
      for (const entry of hydroPacks.values()) deleteHydroPackResources(entry);
      hydroPacks.clear();
      for (const pending of hydroFeatureRequests.values()) pending.reject(new Error('수계 로더가 다시 시작되었습니다.'));
      hydroFeatureRequests.clear();
      state.hydroFragmentsByLogicalId = new Map();
      if (!hydroManifest || !hydroManifestUrl || typeof Worker !== 'function') return;
      hydroWorker = new Worker(runtimeAssetUrl('workers/hydro-tile-worker.js'), { name: 'pandolab-hydro-tiles' });
      hydroWorker.onmessage = receiveHydroWorkerMessage;
      hydroWorker.onerror = event => receiveHydroWorkerMessage({ data: { type: 'error', message: event.message || '수계 Worker 실행 오류' } });
      const hydroRevision = `${ASSET_REVISION}-${String(hydroManifest.index?.sha256 || '').slice(0, 12)}`;
      hydroWorker.postMessage({
        type: 'init', manifest: hydroManifest, baseUrl: new URL('./', hydroManifestUrl).href,
        assetRevision: hydroRevision, includeGeometry: rendererMode === 'canvas2d',
      });
      connectHydroCanvasWorkers();
    }

    function setHydroInteractionActive(active) {
      hydroWorker?.postMessage({ type: 'interaction', active: active === true });
    }

    function invalidateHydroVisibility() {
      hydroVisibilityDirty = true;
      queueHydroRender();
    }

    function terrainLevelForView() {
      if (!terrainManifest?.levels?.length) return null;
      const scale = activeProjection().scale();
      const dpr = resolveRenderPixelRatio();
      const desiredWidth = Math.max(1, 2 * PI * scale * dpr);
      return terrainManifest.levels.find(level => level.width >= desiredWidth * 1.12)
        || terrainManifest.levels[terrainManifest.levels.length - 1];
    }

    function terrainTileSpec(level, column, row) {
      const x0 = column * level.tileSize;
      const y0 = row * level.tileSize;
      const x1 = Math.min(level.width, x0 + level.tileSize);
      const y1 = Math.min(level.height, y0 + level.tileSize);
      return {
        key: `${level.id}/${column}-${row}`,
        level: level.id,
        column,
        row,
        pixelWidth: x1 - x0,
        pixelHeight: y1 - y0,
        bounds: [
          -180 + x0 / level.width * 360,
          90 - y0 / level.height * 180,
          -180 + x1 / level.width * 360,
          90 - y1 / level.height * 180,
        ],
      };
    }

    function visibleTerrainTileSpecs(level, includeAll = false) {
      const specs = [];
      const projection = activeProjection();
      const scale = projection.scale();
      const flatHalfLon = cssWidth / Math.max(1, scale) * 90 / PI;
      const flatHalfLat = cssHeight / Math.max(1, scale) * 90 / PI;
      const globeCenter = [-Number(state.view.globeRotation?.[0] || 0), -Number(state.view.globeRotation?.[1] || 0)];
      const globeRadius = Math.asin(Math.min(1, Math.hypot(cssWidth, cssHeight) * 0.5 / Math.max(1, scale)));
      for (let row = 0; row < level.rows; row += 1) {
        for (let column = 0; column < level.columns; column += 1) {
          const spec = terrainTileSpec(level, column, row);
          if (includeAll) {
            specs.push(spec);
            continue;
          }
          const [west, north, east, south] = spec.bounds;
          const center = [(west + east) / 2, (north + south) / 2];
          const halfLon = (east - west) / 2;
          const halfLat = (north - south) / 2;
          if (state.projection === 'flat') {
            const deltaLon = Math.abs((((center[0] - state.view.flatCenter[0]) + 540) % 360) - 180);
            const deltaLat = Math.abs(center[1] - state.view.flatCenter[1]);
            if (deltaLon <= flatHalfLon + halfLon + 2 && deltaLat <= flatHalfLat + halfLat + 2) specs.push(spec);
          } else {
            const padding = Math.hypot(halfLon, halfLat) * PI / 180;
            if (d3.geo.distance(globeCenter, center) <= globeRadius + padding + 0.04) specs.push(spec);
          }
        }
      }
      return specs;
    }

    function terrainTileUrl(spec) {
      const relative = terrainManifest.urlTemplate
        .replace('{level}', String(spec.level))
        .replace('{column}', String(spec.column))
        .replace('{row}', String(spec.row));
      const url = new URL(relative, PHYSICAL_DATA_BASE_URL);
      url.searchParams.set('v', terrainManifest.version || APP_VERSION);
      return url;
    }

    function requestTerrainTile(spec, priority = 0) {
      if (!gl || terrainTiles.has(spec.key) || terrainTileRequests.has(spec.key)
          || terrainTileQueuedKeys.has(spec.key) || terrainFetchQueuedKeys.has(spec.key)) return;
      const previousFailure = terrainTileFailures.get(spec.key);
      if (previousFailure?.retryAt > performance.now()) return;
      terrainFetchQueuedKeys.add(spec.key);
      terrainFetchQueue.push({ spec, priority: Number(priority || 0) });
      terrainFetchQueue.sort((left, right) => right.priority - left.priority || left.spec.key.localeCompare(right.spec.key));
      pumpTerrainFetchQueue();
    }

    function pumpTerrainFetchQueue() {
      const concurrency = isMobile() ? 2 : 4;
      while (terrainActiveFetches < concurrency && terrainFetchQueue.length) {
        const next = terrainFetchQueue.shift();
        terrainFetchQueuedKeys.delete(next.spec.key);
        startTerrainTileRequest(next.spec, next.priority);
      }
    }

    function startTerrainTileRequest(spec, priority = 0) {
      const previousFailure = terrainTileFailures.get(spec.key);
      terrainActiveFetches += 1;
      const request = (async () => {
        const response = await fetch(terrainTileUrl(spec));
        if (!response.ok) throw new Error(`지형 타일 HTTP ${response.status}`);
        const blob = await response.blob();
        let bitmap;
        try { bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
        catch (_) { bitmap = await createImageBitmap(blob); }
        if (!gl || !isWebGlRenderer()) {
          bitmap.close?.();
          return;
        }
        terrainTileFailures.delete(spec.key);
        terrainTileQueuedKeys.add(spec.key);
        terrainUploadQueue.push({ spec, bitmap });
        scheduleTerrainUpload();
      })().catch(error => {
        const attempts = Number(previousFailure?.attempts || 0) + 1;
        const retryDelay = attempts <= 3 ? Math.min(4000, 400 * 2 ** (attempts - 1)) : 30000;
        terrainTileFailures.set(spec.key, { attempts, retryAt: performance.now() + retryDelay });
        if (attempts <= 3) {
          setTimeout(() => {
            requestTerrainTile(spec, priority);
            scheduleViewRender();
          }, retryDelay);
        }
        console.warn(`지형 타일을 불러오지 못했습니다: ${spec.key}`, error);
      }).finally(() => {
        terrainTileRequests.delete(spec.key);
        terrainActiveFetches = Math.max(0, terrainActiveFetches - 1);
        pumpTerrainFetchQueue();
      });
      terrainTileRequests.set(spec.key, request);
    }

    function scheduleTerrainUpload() {
      if (terrainUploadFrame || !terrainUploadQueue.length) return;
      terrainUploadFrame = requestAnimationFrame(() => {
        terrainUploadFrame = 0;
        const next = terrainUploadQueue.shift();
        if (!next) return;
        const { spec, bitmap } = next;
        terrainTileQueuedKeys.delete(spec.key);
        if (!gl || !isWebGlRenderer()) {
          bitmap.close?.();
          scheduleTerrainUpload();
          return;
        }
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        bitmap.close?.();
        terrainTiles.set(spec.key, { texture, lastUsed: performance.now() });
        while (terrainTiles.size > 96) {
          let oldest = null;
          for (const item of terrainTiles.entries()) if (!oldest || item[1].lastUsed < oldest[1].lastUsed) oldest = item;
          if (!oldest || oldest[0] === spec.key) break;
          gl.deleteTexture(oldest[1].texture);
          terrainTiles.delete(oldest[0]);
        }
        scheduleViewRender();
        scheduleTerrainUpload();
      });
    }

    function terrainGridMesh(spec) {
      const spanLon = Math.abs(spec.bounds[2] - spec.bounds[0]);
      const spanLat = Math.abs(spec.bounds[1] - spec.bounds[3]);
      const stepsX = Math.max(1, Math.ceil(spanLon / 0.499));
      const stepsY = Math.max(1, Math.ceil(spanLat / 0.499));
      const key = `${stepsX}x${stepsY}`;
      if (terrainGridMeshes.has(key)) return terrainGridMeshes.get(key);
      const vertices = new Float32Array((stepsX + 1) * (stepsY + 1) * 2);
      let vertexOffset = 0;
      for (let y = 0; y <= stepsY; y += 1) {
        for (let x = 0; x <= stepsX; x += 1) {
          vertices[vertexOffset++] = x / stepsX;
          vertices[vertexOffset++] = y / stepsY;
        }
      }
      const indices = new Uint32Array(stepsX * stepsY * 6);
      let indexOffset = 0;
      for (let y = 0; y < stepsY; y += 1) {
        for (let x = 0; x < stepsX; x += 1) {
          const a = y * (stepsX + 1) + x;
          const b = a + 1;
          const c = a + stepsX + 1;
          const d = c + 1;
          indices[indexOffset++] = a; indices[indexOffset++] = c; indices[indexOffset++] = b;
          indices[indexOffset++] = b; indices[indexOffset++] = c; indices[indexOffset++] = d;
        }
      }
      const vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      const meshEntry = { vertexBuffer, indexBuffer, indexCount: indices.length };
      terrainGridMeshes.set(key, meshEntry);
      return meshEntry;
    }

    function drawTerrainTile(spec) {
      const tile = terrainTiles.get(spec.key);
      if (!tile || !terrainProgram) return false;
      tile.lastUsed = performance.now();
      const grid = terrainGridMesh(spec);
      gl.useProgram(terrainProgram);
      const gridLocation = glVersion === 2 ? 0 : gl.getAttribLocation(terrainProgram, 'aGrid');
      gl.bindBuffer(gl.ARRAY_BUFFER, grid.vertexBuffer);
      gl.enableVertexAttribArray(gridLocation);
      gl.vertexAttribPointer(gridLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.indexBuffer);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tile.texture);
      gl.uniform1i(gl.getUniformLocation(terrainProgram, 'uTerrain'), 1);
      const [west, north, east, south] = spec.bounds;
      gl.uniform4f(gl.getUniformLocation(terrainProgram, 'uGeoBounds'), west, north, east, south);
      const gutter = Number(terrainManifest.gutter || 0);
      const u0 = gutter / (spec.pixelWidth + gutter * 2);
      const v0 = gutter / (spec.pixelHeight + gutter * 2);
      const u1 = (gutter + spec.pixelWidth) / (spec.pixelWidth + gutter * 2);
      const v1 = (gutter + spec.pixelHeight) / (spec.pixelHeight + gutter * 2);
      gl.uniform4f(gl.getUniformLocation(terrainProgram, 'uUvBounds'), u0, v0, u1, v1);
      gl.uniform1f(gl.getUniformLocation(terrainProgram, 'uPhysicalStyle'), state.physicalSettings.terrainStyle === 'physical' ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(terrainProgram, 'uDarkTheme'), getSystemTheme() === 'dark' ? 1 : 0);
      const offsets = state.projection === 'globe' ? [0] : [-2 * PI, 0, 2 * PI];
      for (const offset of offsets) {
        setViewUniforms(terrainProgram, offset);
        gl.drawElements(gl.TRIANGLES, grid.indexCount, gl.UNSIGNED_INT, 0);
      }
      gl.disableVertexAttribArray(gridLocation);
      return true;
    }

    function renderTerrain() {
      if (!state.physicalSettings.terrainVisible || !terrainManifest?.levels?.length || !terrainProgram) return;
      const levels = terrainManifest.levels;
      const baseLevel = levels[0];
      const targetLevel = terrainLevelForView() || baseLevel;
      const targetIndex = Math.max(0, levels.findIndex(level => Number(level.id) === Number(targetLevel.id)));
      const activeLevels = levels.slice(0, (state.dataReadiness === 'enhanced' ? targetIndex : 0) + 1);
      const specsByLevel = activeLevels.map((level, index) => ({
        level,
        specs: visibleTerrainTileSpecs(level, false),
      }));
      const targetSpecs = specsByLevel[specsByLevel.length - 1].specs;
      terrainLastLevel = Number(activeLevels[activeLevels.length - 1].id);
      terrainTargetTileCount = targetSpecs.length;
      terrainTargetTilesLoaded = targetSpecs.filter(spec => terrainTiles.has(spec.key)).length;
      for (let index = 0; index < specsByLevel.length; index += 1) {
        const priority = index === 0 ? 10_000 : 1_000 - index;
        for (const spec of specsByLevel[index].specs) requestTerrainTile(spec, priority);
      }
      terrainRenderedLevel = -1;
      for (const entry of specsByLevel) {
        let rendered = false;
        for (const spec of entry.specs) rendered = drawTerrainTile(spec) || rendered;
        if (rendered) terrainRenderedLevel = Number(entry.level.id);
      }
    }

    function renderWebGl() {
      if (!gl || !mesh) return;
      resize();
      requestHydroView();
      const started = performance.now();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.disable(gl.BLEND);
      const dynamicResources = overrideMesh ? { positionBuffer: overridePositionBuffer, countryBuffer: overrideCountryBuffer } : null;
      if (state.physicalSettings.terrainVisible && state.physicalSettings.terrainStyle !== 'physical') {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.colorMask(false, false, false, false);
        drawProgram(landMaskProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES);
        if (overrideMesh?.triangleIndices?.length) drawProgram(landMaskProgram, overrideFillVao, overrideFillIndexBuffer, overrideMesh.triangleIndices.length, gl.TRIANGLES, dynamicResources, overridePaletteTexture);
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0x00);
        gl.stencilFunc(gl.EQUAL, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        renderTerrain();
        gl.disable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
      } else {
        renderTerrain();
      }
      updatePalette();
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (state.layerVisibility.countries) {
        drawProgram(fillProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES);
        if (overrideMesh?.triangleIndices?.length) drawProgram(fillProgram, overrideFillVao, overrideFillIndexBuffer, overrideMesh.triangleIndices.length, gl.TRIANGLES, dynamicResources, overridePaletteTexture);
      }
      drawHydro('lake');
      drawHydro('river');
      if (state.layerVisibility.countries) {
        drawProgram(lineProgram, lineVao, lineIndexBuffer, mesh.lineIndices.length, gl.LINES);
        if (overrideMesh?.lineIndices?.length) drawProgram(lineProgram, overrideLineVao, overrideLineIndexBuffer, overrideMesh.lineIndices.length, gl.LINES, dynamicResources, overridePaletteTexture);
      }
      drawHydro('border-river');
      gl.flush();
      displayedRenderRevision = currentRenderRevision;
      frameTimes.push(performance.now() - started);
      if (frameTimes.length > 240) frameTimes.shift();
      window.__PANDOLAB_GPU_METRICS__ = getStats();
    }

    function renderCanvasFallback() {
      if (!ctx2d || !canvas) return;
      resize();
      const dpr = pixelWidth / cssWidth;
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.clearRect(0, 0, pixelWidth, pixelHeight);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!state.layerVisibility.countries) return;
      const canvasPath = d3.geo.path().projection(activeProjection()).context(ctx2d);
      const theme = mapTheme();
      ctx2d.lineJoin = 'round';
      ctx2d.lineWidth = 0.72 * Math.max(0.5, Number(theme.borderWidth) || 1);
      for (const feature of state.countriesData?.features || []) {
        if (!isLayerItemVisible('countries', feature.properties?.editor_id || '')) continue;
        ctx2d.beginPath();
        canvasPath(feature);
        ctx2d.globalAlpha = theme.fillAlpha;
        ctx2d.fillStyle = countryColor(feature);
        ctx2d.fill();
        ctx2d.beginPath();
        canvasPath(countryOutlineFeature(feature));
        ctx2d.globalAlpha = theme.borderAlpha;
        ctx2d.strokeStyle = theme.border;
        ctx2d.stroke();
      }
      ctx2d.globalAlpha = 1;
      displayedRenderRevision = currentRenderRevision;
    }

    function canvasWorkerRenderMessage(type = 'render', revision = currentRenderRevision) {
      const colors = {};
      for (const feature of state.countriesData?.features || []) {
        colors[String(feature.properties?.editor_id || feature.properties?.iso_a3 || '')] = countryColor(feature);
      }
      return {
        type,
        width: Math.max(1, state.size.width),
        height: Math.max(1, state.size.height),
        dpr: resolveRenderPixelRatio(),
        projection: state.projection,
        view: deepClone(state.view),
        revision: Number(revision || 0),
        geometryRevision: geometryRevisionTracker.committedRevision(),
        visible: !!state.layerVisibility.countries,
        hydroVisible: !!state.layerVisibility.drawings,
        hiddenCountryIds: Object.keys(state.itemVisibility.countries || {}).filter(id => state.itemVisibility.countries[id] === false),
        colors,
        theme: mapTheme(),
        physicalSettings: deepClone(state.physicalSettings),
        darkTheme: getSystemTheme() === 'dark',
        dataReadiness: state.dataReadiness,
        terrainFetchConcurrency: isMobile() ? 2 : 4,
        terrainManifestUrl: new URL('terrain/v0.12.6/manifest.json', PHYSICAL_DATA_BASE_URL).href,
      };
    }

    function postCanvasWorkerFrame(message) {
      if (!canvasWorker || !canvasWorkerReady) {
        canvasWorkerPendingMessage = message;
        return;
      }
      canvasWorkerBusy = true;
      canvasWorker.postMessage(message);
    }

    function renderCanvasWorker(revision = currentRenderRevision) {
      if (!canvasWorker) return;
      resize();
      const message = canvasWorkerRenderMessage('render', revision);
      canvasWorkerLatestRequestedRevision = Math.max(canvasWorkerLatestRequestedRevision, message.revision);
      if (!canvasWorkerReady || canvasWorkerBusy) {
        canvasWorkerPendingMessage = message;
        return;
      }
      postCanvasWorkerFrame(message);
    }

    function render(revision = currentRenderRevision) {
      currentRenderRevision = Math.max(currentRenderRevision, Number(revision || 0));
      requestHydroView();
      if (isWebGlRenderer()) renderWebGl();
      else if (rendererMode === 'canvas-worker') renderCanvasWorker(currentRenderRevision);
      else if (rendererMode === 'canvas2d') renderCanvasFallback();
      window.__PANDOLAB_GPU_METRICS__ = getStats();
    }

    function prioritizeLatest() {
      if (rendererMode !== 'canvas-worker' || !canvasWorker) return;
      const message = canvasWorkerRenderMessage('render', currentRenderRevision);
      canvasWorkerLatestRequestedRevision = Math.max(canvasWorkerLatestRequestedRevision, message.revision);
      if (!canvasWorkerReady || canvasWorkerBusy) {
        if (!canvasWorkerPendingMessage || canvasWorkerPendingMessage.revision <= message.revision) {
          canvasWorkerPendingMessage = message;
        }
        return;
      }
      postCanvasWorkerFrame(message);
    }

    function failCanvasWorker(message) {
      console.warn('Canvas worker failed', message);
      canvasWorker?.terminate();
      canvasWorker = null;
      canvasWorkerReady = false;
      canvasWorkerBusy = false;
      canvasWorkerPendingMessage = null;
      for (const pending of canvasHydroPickRequests.values()) pending.resolve(null);
      canvasHydroPickRequests.clear();
      replaceCanvas();
      rendererMode = 'canvas2d';
      resize();
      ctx2d = canvas.getContext('2d', { alpha: true });
      if (!ctx2d) throw new Error('Canvas 대체 렌더러도 사용할 수 없습니다.');
      $('engineStatus').textContent = `Canvas ${meshQualityLabel()} 대체 · ${fallbackReason}`;
      updateRendererStatus(`Canvas · ${meshQualityLabel()} 대체`, fallbackReason);
      setActionStatus(`${meshQualityLabel()} Canvas 렌더러로 전환했습니다. 사유: ${fallbackReason}`, 'working', 4200);
      if (hydroManifest && hydroManifestUrl) setHydroManifest(hydroManifest, hydroManifestUrl);
      renderCanvasFallback();
      completeGeometryDisplay(
        geometryRevisionTracker.pendingIds(),
        geometryRevisionTracker.committedRevision(),
        { renderFrame: false },
      );
    }

    function receiveCanvasWorkerMessage(event) {
      const message = event.data || {};
      if (message.type === 'ready') {
        canvasWorkerReady = true;
        const pending = canvasWorkerPendingMessage || canvasWorkerRenderMessage('render', currentRenderRevision);
        canvasWorkerPendingMessage = null;
        postCanvasWorkerFrame(pending);
        return;
      }
      if (message.type === 'terrain-ready') {
        renderCanvasWorker(currentRenderRevision);
        return;
      }
      if (message.type === 'terrain-warning') {
        console.warn('Canvas 지형 타일을 불러오지 못했습니다.', message.message || '알 수 없는 오류');
        return;
      }
      if (message.type === 'data-ready') {
        const geometryRevision = Number(message.geometryRevision || 0);
        const taskToken = Number(message.taskToken || 0);
        if (taskToken && !geometryRevisionTracker.isCurrent(taskToken, geometryRevision)) return;
        if (lastGeometryCommitTimings && geometryRevision === geometryRevisionTracker.committedRevision()) {
          lastGeometryCommitTimings.patchWorkerCompletedAt ||= performance.now();
        }
        if (message.replaceAll) {
          countryOverrideIds.clear();
          overrideFeatureSnapshots.clear();
          overrideMesh = null;
        }
        canvasDataReplacementResolver?.();
        canvasDataReplacementResolver = null;
        renderCanvasWorker(currentRenderRevision);
        return;
      }
      if (message.type === 'hydro-pick') {
        const pending = canvasHydroPickRequests.get(Number(message.requestId));
        if (pending) {
          canvasHydroPickRequests.delete(Number(message.requestId));
          pending.resolve(Number.isFinite(Number(message.fid)) ? state.hydroFeatureByFid.get(Number(message.fid)) || null : null);
        }
        return;
      }
      if (message.type === 'error') {
        failCanvasWorker(message.message || 'Canvas Worker 렌더링 오류');
        return;
      }
      if (message.type !== 'frame') return;
      canvasWorkerBusy = false;
      const revision = Number(message.revision || 0);
      const geometryRevision = Number(message.geometryRevision || 0);
      const canDisplay = revision >= canvasWorkerDisplayedRevision
        && revision >= canvasWorkerLatestRequestedRevision
        && geometryRevision >= geometryRevisionTracker.committedRevision();
      if (canDisplay && message.bitmap) {
        if (canvasWorkerBitmapContext) {
          canvasWorkerBitmapContext.transferFromImageBitmap(message.bitmap);
        } else if (canvasWorker2dContext) {
          canvasWorker2dContext.setTransform(1, 0, 0, 1, 0, 0);
          canvasWorker2dContext.clearRect(0, 0, canvas.width, canvas.height);
          canvasWorker2dContext.drawImage(message.bitmap, 0, 0, canvas.width, canvas.height);
          message.bitmap.close?.();
        }
        canvasWorkerDisplayedRevision = revision;
        displayedRenderRevision = revision;
        completeGeometryDisplay(geometryRevisionTracker.pendingIds(), geometryRevision, { renderFrame: false });
      } else {
        message.bitmap?.close?.();
      }
      const pending = canvasWorkerPendingMessage;
      canvasWorkerPendingMessage = null;
      if (pending) postCanvasWorkerFrame(pending);
    }

    function activateCanvasFallback(reason) {
      const rawReason = String(reason || '');
      if (rawReason && !isSafeKoreanErrorMessage({ message: rawReason })) console.warn('[PL-GPU-005]', rawReason);
      fallbackReason = isSafeKoreanErrorMessage({ message: rawReason }) ? rawReason : 'GPU 렌더러를 사용할 수 없습니다.';
      clearTimeout(webglRecoveryTimer);
      webglContextLost = false;
      canvasWorker?.terminate();
      canvasWorker = null;
      canvasWorkerReady = false;
      canvasWorkerBusy = false;
      canvasWorkerPendingMessage = null;
      if (canvasWorkerUrl) URL.revokeObjectURL(canvasWorkerUrl);
      canvasWorkerUrl = null;
      if (canvas) replaceCanvas();
      if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
        try {
          rendererMode = 'canvas-worker';
          resize();
          const canvasRuntimeUrl = runtimeAssetUrl('workers/canvas-render-worker.js');
          canvasRuntimeUrl.searchParams.set('physical', '1');
          canvasWorker = new Worker(canvasRuntimeUrl, {
            name: 'pandolab-canvas-renderer',
          });
          canvasWorkerReady = false;
          canvasWorkerBusy = false;
          canvasWorkerPendingMessage = canvasWorkerRenderMessage('render', currentRenderRevision);
          canvasWorkerLatestRequestedRevision = currentRenderRevision;
          canvasWorkerDisplayedRevision = 0;
          canvasWorkerBitmapContext = canvas.getContext('bitmaprenderer');
          if (!canvasWorkerBitmapContext) canvasWorker2dContext = canvas.getContext('2d', { alpha: true });
          if (!canvasWorkerBitmapContext && !canvasWorker2dContext) throw new Error('Canvas 표시 컨텍스트를 만들 수 없습니다.');
          const initMessage = canvasWorkerRenderMessage('init');
          initMessage.features = state.countriesData?.features || [];
          canvasWorker.postMessage(initMessage);
          canvasWorker.onmessage = receiveCanvasWorkerMessage;
          canvasWorker.onerror = event => failCanvasWorker(event.message || 'Canvas Worker 실행 오류');
          if (hydroManifest && hydroManifestUrl) setHydroManifest(hydroManifest, hydroManifestUrl);
          else connectHydroCanvasWorkers();
          $('engineStatus').textContent = `Canvas Worker ${meshQualityLabel()} · ${fallbackReason}`;
          updateRendererStatus('Canvas Worker · 완성 프레임 즉시 표시', fallbackReason);
          setActionStatus(`${meshQualityLabel()} Canvas Worker로 전환했습니다. 사유: ${fallbackReason}`, 'working', 4200);
          window.__PANDOLAB_GPU_METRICS__ = getStats();
          return;
        } catch (error) {
          console.warn('Canvas worker unavailable', error);
          canvasWorker?.terminate();
          canvasWorker = null;
          replaceCanvas();
        }
      }
      rendererMode = 'canvas2d';
      ctx2d = canvas.getContext('2d', { alpha: true });
      if (!ctx2d) throw new Error('Canvas 대체 렌더러도 사용할 수 없습니다.');
      $('engineStatus').textContent = `Canvas ${meshQualityLabel()} 대체 · ${fallbackReason}`;
      updateRendererStatus(`Canvas · ${meshQualityLabel()} 대체`, fallbackReason);
      setActionStatus(`GPU를 사용할 수 없어 ${meshQualityLabel()} Canvas 렌더러로 전환했습니다.`, 'working', 4200);
      if (hydroManifest && hydroManifestUrl) setHydroManifest(hydroManifest, hydroManifestUrl);
      renderCanvasFallback();
      completeGeometryDisplay(
        geometryRevisionTracker.pendingIds(),
        geometryRevisionTracker.committedRevision(),
        { renderFrame: false },
      );
      window.__PANDOLAB_GPU_METRICS__ = getStats();
    }

    function ensurePickTarget() {
      if (pickFramebuffer && pickTexture) return;
      pickFramebuffer = gl.createFramebuffer();
      pickTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, pickTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const internalFormat = glVersion === 2 ? gl.RGBA8 : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, pixelWidth, pixelHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTexture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU 선택 버퍼 생성 실패');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function pick(screenPoint) {
      if (!isWebGlRenderer() || !gl || !mesh || !state.layerVisibility.countries) return null;
      resize();
      try { ensurePickTarget(); } catch (_) { return null; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawProgram(pickProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES);
      if (overrideMesh?.triangleIndices?.length) {
        drawProgram(
          pickProgram,
          overrideFillVao,
          overrideFillIndexBuffer,
          overrideMesh.triangleIndices.length,
          gl.TRIANGLES,
          { positionBuffer: overridePositionBuffer, countryBuffer: overrideCountryBuffer },
          overridePaletteTexture,
        );
      }
      const dpr = pixelWidth / cssWidth;
      const x = Math.max(0, Math.min(pixelWidth - 1, Math.round(screenPoint[0] * dpr)));
      const y = Math.max(0, Math.min(pixelHeight - 1, Math.round(pixelHeight - 1 - screenPoint[1] * dpr)));
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const index = (pixel[0] | (pixel[1] << 8) | (pixel[2] << 16)) - 1;
      return index >= 0 ? meshCountryIds[index] || null : null;
    }

    function pickHydro(screenPoint) {
      if (!isWebGlRenderer() || !gl || !hydroManifest || !hydroActivePackIds.size || !state.layerVisibility.drawings) return null;
      resize();
      try { ensurePickTarget(); } catch (_) { return null; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawHydro('lake', true);
      drawHydro('river', true);
      drawHydro('border-river', true);
      const dpr = pixelWidth / cssWidth;
      const x = Math.max(0, Math.min(pixelWidth - 1, Math.round(screenPoint[0] * dpr)));
      const y = Math.max(0, Math.min(pixelHeight - 1, Math.round(pixelHeight - 1 - screenPoint[1] * dpr)));
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const fid = (pixel[0] | (pixel[1] << 8) | (pixel[2] << 16)) - 1;
      return fid >= 0 ? state.hydroFeatureByFid.get(fid) || null : null;
    }

    function pickHydroAsync(screenPoint) {
      if (rendererMode !== 'canvas-worker' || !canvasWorker || !canvasWorkerReady) return Promise.resolve(null);
      const requestId = ++canvasHydroPickRequestId;
      return new Promise(resolve => {
        canvasHydroPickRequests.set(requestId, { resolve });
        canvasWorker.postMessage({ type: 'hydro-pick', requestId, point: screenPoint });
        setTimeout(() => {
          const pending = canvasHydroPickRequests.get(requestId);
          if (!pending) return;
          canvasHydroPickRequests.delete(requestId);
          pending.resolve(null);
        }, 900);
      });
    }

    async function initialize() {
      if (forcedRenderer === 'canvas') {
        activateCanvasFallback('강제 Canvas 테스트');
        return false;
      }
      let decoded = null;
      const failures = [];
      const versions = forcedRenderer === 'webgl2' ? [2] : forcedRenderer === 'webgl1' ? [1] : [2, 1];
      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index];
        if (index > 0 || gl) replaceCanvas();
        try {
          initWebGl(version);
          $('engineStatus').textContent = `${rendererName()} · 빠른 미리보기 메시를 준비하는 중입니다.`;
          updateRendererStatus(`${rendererName()} · 빠른 GPU 지도를 준비하는 중입니다.`);
          if (!decoded) decoded = await decodeBuiltInMesh();
          setMesh(decoded.mesh, decoded.ids);
          meshQuality = 'preview';
          canonicalMeshReady = false;
          if (isWebGlRenderer()) {
            $('engineStatus').textContent = `Natural Earth 5.1.1 · ${rendererName()} 빠른 미리보기`;
            updateRendererStatus(`${rendererName()} · 빠른 GPU 미리보기`);
            return true;
          }
        } catch (error) {
          const message = error?.message || String(error);
          failures.push(`${version === 2 ? 'WebGL2' : 'WebGL1'}: ${message}`);
          console.warn(`${version === 2 ? 'WebGL2' : 'WebGL1'} renderer unavailable`, error);
        }
      }
      if (gl) replaceCanvas();
      activateCanvasFallback(failures.join(' / ') || 'WebGL을 사용할 수 없습니다.');
      return false;
    }

    async function replaceBuiltInMesh({ meshBuffer, features, quality = 'canonical' }) {
      const decoded = await decodeBuiltInMesh(meshBuffer, features);
      setMesh(decoded.mesh, decoded.ids, { renderFrame: false });
      meshQuality = quality;
      canonicalMeshReady = quality === 'canonical';
      if (rendererMode === 'canvas-worker' && canvasWorker) {
        await new Promise(resolve => {
          const timeout = setTimeout(() => {
            if (canvasDataReplacementResolver === complete) canvasDataReplacementResolver = null;
            resolve();
          }, 3000);
          const complete = () => {
            clearTimeout(timeout);
            resolve();
          };
          canvasDataReplacementResolver = complete;
          canvasWorker.postMessage({
            type: 'replace-data',
            revision: Number(currentRenderRevision || 0),
            geometryRevision: geometryRevisionTracker.committedRevision(),
            features: features || state.countriesData?.features || [],
          });
        });
      } else {
        completeGeometryDisplay(
          geometryRevisionTracker.pendingIds(),
          geometryRevisionTracker.committedRevision(),
        );
      }
      updateRendererStatus(isWebGlRenderer()
        ? `${rendererName()} · GPU ${meshQualityLabel()}`
        : `${rendererMode === 'canvas-worker' ? 'Canvas Worker' : 'Canvas'} · ${meshQualityLabel()}`,
      fallbackReason);
      return decoded;
    }

    function setTerrainManifest(manifest) {
      terrainManifest = manifest?.levels?.length ? manifest : null;
      terrainLastLevel = -1;
      if (terrainManifest && isWebGlRenderer()) {
        for (const spec of visibleTerrainTileSpecs(terrainManifest.levels[0], false)) requestTerrainTile(spec, 10_000);
      }
      render(currentRenderRevision);
    }

    function getStats() {
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
      return {
        renderer: rendererMode,
        effectivePixelRatio,
        devicePixelRatio: Math.max(1, Number(window.devicePixelRatio || 1)),
        meshQuality,
        canonicalMeshReady,
        countries: meshCountryIds.length,
        renderVertices: mesh?.countryIndices?.length || 0,
        triangleCount: (mesh?.triangleIndices?.length || 0) / 3,
        lineSegmentCount: (mesh?.lineIndices?.length || 0) / 2,
        p95CpuSubmitMs: Number(p95.toFixed(3)),
        viewportCss: [Number(cssWidth.toFixed(3)), Number(cssHeight.toFixed(3))],
        canvasBackingPixels: [pixelWidth, pixelHeight],
        layoutMismatchCssPx: Number(layoutMismatch().toFixed(3)),
        requestedRevision: currentRenderRevision,
        displayedRevision: displayedRenderRevision,
        committedGeometryRevision: geometryRevisionTracker.committedRevision(),
        displayedGeometryRevision: geometryRevisionTracker.displayedRevision(),
        pendingCountryCount: geometryRevisionTracker.pendingIds().length,
        pendingOldMeshVisibleCount,
        geometryRenderTaskToken: geometryRevisionTracker.taskToken(),
        lastGeometryCommitTimings: lastGeometryCommitTimings ? { ...lastGeometryCommitTimings } : null,
        canvasWorkerBusy,
        canvasWorkerHasPendingFrame: !!canvasWorkerPendingMessage,
        webglContextLost,
        webGlVersion: glVersion || null,
        forcedRenderer: forcedRenderer || null,
        fallbackReason,
        terrainLevel: terrainLastLevel,
        terrainRenderedLevel,
        terrainTargetTileCount,
        terrainTargetTilesLoaded,
        terrainTilesLoaded: terrainTiles.size,
        terrainTilesLoading: terrainTileRequests.size + terrainFetchQueue.length,
        terrainFetchConcurrency: isMobile() ? 2 : 4,
        hydroFeaturesLoaded: state.hydroFeatureCache?.size || 0,
        hydroPacksLoaded: hydroPacks.size,
        hydroPacksActive: hydroActivePackIds.size,
        hydroCacheBytes: [...hydroPacks.values()].reduce((sum, entry) => sum + Number(entry.byteLength || 0), 0),
      };
    }

    return {
      attach, initialize, replaceBuiltInMesh, render, resize, verifyLayout, pick, pickHydro, pickHydroAsync,
      rebuildFromCountries, applyCountryPatch, compactCountryOverrides, prioritizeLatest, getStats, setTerrainManifest,
      setHydroManifest, loadHydroLogicalFeature, retryHydroCache,
      setHydroInteractionActive, setInteractionActive: setHydroInteractionActive, renderViewFrame: render,
      invalidateHydroVisibility, resetCountryGeometryVisualState,
    };
  })();
}
