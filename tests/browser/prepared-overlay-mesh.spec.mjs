import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixedGeometry = JSON.parse(readFileSync(new URL('../../assets/data/territorial-entities/generated/current-world.geojson', import.meta.url)))
  .features.find(feature => feature.id === 'AND').geometry;

test('actual scene prepares fixed assets, edited Worker meshes and latest style without blocking publication', async ({ page }) => {
  await page.goto('/assets/data/prepared-polygons/generated/v1/manifest.json');
  const result = await page.evaluate(async geometry => {
    const { createGpuScene } = await import('/assets/js/modules/app-gpu-scene.js');
    const { createRenderSceneBuilder } = await import('/assets/js/modules/render-scene.js');
    const errors = [], scenes = [], requests = [], workerStats = [];
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      constructor(...args) { super(...args); this.addEventListener('message', event => {
        if (event.data.result?.stats) workerStats.push(event.data.result.stats);
      }); }
      postMessage(message, ...args) { if (message.type === 'request') requests.push(message); super.postMessage(message, ...args); }
    };
    const state = { projection: 'globe', layerVisibility: {}, physicalSettings: {}, stateRevision: 0 };
    const interaction = { currentGpuInteractionFillItems: [], currentGpuPreviewPackets: [], currentGpuEditPreviewPackets: [], currentGpuDraftPackets: [] };
    const owner = createGpuScene();
    owner.connect({ platform: { runtimeAssetUrl: path => `/assets/js/${path}` }, projectState: { state },
      renderScene: { createRenderSceneBuilder, OVERLAY_GROUPS: [], currentRenderQuality: { revision: 0, backgroundLod: 'high', renderPacketCacheBudgetBytes: 20e6 } },
      interactionPresentation: interaction, interactionStateCommands: { replaceGpuInteractionFillItems: items => { interaction.currentGpuInteractionFillItems = items; } },
      countries: { countryLandRevision: 0 }, mapLayout: { viewRevision: 0 }, feedback: { reportOperationError: error => errors.push(error.message) },
      domains: { renderingDomain: { invalidateGpuInteraction() {} } }, rendering: { gpuMapRenderer: { setRenderScene: scene => scenes.push(scene) } } });
    owner.initializeRenderSceneBuilder(); owner.initializeGpuSceneDomains(); owner.initializeGpuSceneResourceObjectKeys();
    const set = (value, revision, color) => owner.replaceGpuSceneDomain('territorial', { polygons: [{ key: 'one', geometry: value,
      geometryRevision: revision, style: { color }, lodPolicy: 'exact' }] });
    const settle = async condition => {
      const end = performance.now() + 8000;
      while (!condition() && !errors.length && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
      if (errors.length) throw new Error(errors.join('\n'));
      if (!condition()) throw new Error('Scene preparation timed out');
    };
    set(geometry, 1, '#ff0000'); owner.syncGpuRenderScene();
    set(geometry, 1, '#0000ff'); owner.syncGpuRenderScene();
    await settle(() => scenes.length);
    const fixed = scenes.at(-1).polygons[0], count = requests.length;
    set(geometry, 1, '#00ff00'); owner.syncGpuRenderScene();
    const reused = fixed.positions === scenes.at(-1).polygons[0].positions && count === requests.length;
    const edit = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 2], [0, 2], [0, 0]]] };
    set(edit, 2, '#ff0000'); owner.syncGpuRenderScene();
    const latest = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]] };
    set(latest, 3, '#ffffff'); owner.syncGpuRenderScene();
    await settle(() => scenes.at(-1).polygons[0].geometryRevision === 3);
    const final = scenes.at(-1).polygons[0];
    owner.renderSceneBuilder.clear(); window.Worker = WorkerClass;
    return { reused, color: fixed.style.color, editedColor: final.style.color, right: Math.max(...final.positions.filter((_v, index) => index % 2 === 0)),
      triangles: final.triangleCount, fixedStats: workerStats[0], operations: requests.map(request => request.operation), errors };
  }, fixedGeometry);
  expect(result).toMatchObject({ reused: true, color: '#0000ff', editedColor: '#ffffff', right: 4, errors: [] });
  expect(result.triangles).toBeGreaterThan(2);
  expect(result.fixedStats).toMatchObject({ assetHits: 1, builds: 0 });
  expect(result.operations.every(operation => operation === 'geometry.prepare')).toBe(true);
});

test('draft and preview fills share Worker preparation and discard superseded interaction geometry', async ({ page }) => {
  await page.goto('/assets/data/prepared-polygons/generated/v1/manifest.json');
  const result = await page.evaluate(async () => {
    const { createInteractionPackets } = await import('/assets/js/modules/app-interaction-packets.js');
    const { createRenderSceneBuilder } = await import('/assets/js/modules/render-scene.js');
    const { geometryRevisionKey } = await import('/assets/js/modules/geometry-versions.js');
    const { resolveMapInteractionStyle } = await import('/assets/js/modules/map-interaction-style.js');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); document.body.append(svg);
    const node = document.createElementNS(svg.namespaceURI, 'path'); node.setAttribute('class','draft-shape'); svg.append(node);
    const layer = { selectAll: selector => ({ each: callback => svg.querySelectorAll(selector).forEach(value => callback.call(value)) }) };
    const preferences = { resolvedInteractionStyle: resolveMapInteractionStyle({ selectionColor: '#ff0000' }) }, errors = [];
    const packets = createInteractionPackets();
    packets.connect({ platform: { runtimeAssetUrl: path => `/assets/js/${path}` }, projectState: { state: { projection: 'globe' } }, preferences,
      renderScene: { createRenderSceneBuilder, selectionGeometryRevision: (_key,_role,feature) => geometryRevisionKey(feature.geometry),
        featureFromGeometry: geometry => ({ type: 'Feature',geometry }), syncGpuInteractionState() {} },
      domains: { renderingDomain: { invalidateGpuInteraction() {} } }, feedback: { reportOperationError: error => errors.push(error.message) } });
    packets.initializeInteractionSceneBuilder(); packets.initializeCurrentGpuInteractionFillItems();
    const shape = right => ({ type: 'Polygon',coordinates: [[[0,0],[right,0],[right,2],[0,2],[0,0]]] });
    node.__data__ = { key: 'edit', geometry: shape(3) }; packets.syncGpuInteractionLayer('draft',layer);
    node.__data__ = { key: 'edit', geometry: shape(4) }; packets.syncGpuInteractionLayer('draft',layer);
    preferences.resolvedInteractionStyle = resolveMapInteractionStyle({ selectionColor: '#0000ff' }); packets.syncGpuInteractionLayer('draft',layer);
    const end = performance.now() + 8000;
    while (!packets.currentGpuDraftPackets.some(value => value.kind === 'polygon') && !errors.length && performance.now() < end)
      await new Promise(resolve => setTimeout(resolve,10));
    if (errors.length) throw new Error(errors.join('\n'));
    const fill = packets.currentGpuDraftPackets.find(value => value.kind === 'polygon')?.packet;
    if (!fill) throw new Error('Interaction mesh timed out');
    packets.syncGpuInteractionLayer('draft',layer);
    const reused = packets.currentGpuDraftPackets.find(value => value.kind === 'polygon').packet.positions === fill.positions;
    const result = { color: fill.style.color, right: Math.max(...fill.positions.filter((_v,index) => index%2===0)), reused };
    packets.initializeInteractionSceneBuilder(); return result;
  });
  expect(result).toEqual({ color: '#0000ff', right: 4, reused: true });
});

test('real WebGL faces stay within the independently projected concave shell and hole at maximum review scale', async ({ page }) => {
  await page.goto('/assets/data/prepared-polygons/generated/v1/manifest.json');
  const results = await page.evaluate(async () => {
    const { buildPolygonGeometryPacket } = await import('/assets/js/modules/render-scene.js');
    const { createGpuPolygonOverlayPass } = await import('/assets/js/modules/gpu-polygon-overlay-pass.js');
    const { createRenderDevice } = await import('/assets/js/modules/render-device.js');
    const { setGpuViewUniforms } = await import('/assets/js/modules/gpu-view-uniforms.js');
    const { createGpuStrokeRenderer } = await import('/assets/js/modules/gpu-stroke-renderer.js');
    const radians = Math.PI / 180, width = 2560, height = 2560, scale = width / (2 * Math.PI) * 64;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is required for the actual projection regression');
    const pass = createGpuPolygonOverlayPass();
    if (!pass.initialize(createRenderDevice({ gl, canvas }))) throw new Error('Overlay pass initialization failed');
    gl.viewport(0, 0, width, height);
    const contains = (point, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    };
    const distance = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    const results = [];
    for (const [mode, longitude] of [[0, 0], [0, 179], [1, 179]]) {
      const latitude = 45, lon = longitude * radians, lat = latitude * radians;
      const rowX = [-Math.sin(lon), Math.cos(lon), 0];
      const rowY = [Math.sin(lat) * Math.cos(lon), Math.sin(lat) * Math.sin(lon), -Math.cos(lat)];
      const rowZ = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
      const rings = [[[-2,-2],[2,-2],[2,2],[0.2,2],[0.2,0.8],[-0.2,0.8],[-0.2,2],[-2,2],[-2,-2]],
        [[-1,-1],[-1,0.5],[0,0.5],[0,-1],[-1,-1]]].map(ring => ring.map(([x,y]) => [longitude + x, latitude + y]));
      const geometry = { type: 'Polygon', coordinates: rings.map(ring => ring.map(([x,y]) => [x > 180 ? x - 360 : x, y])) };
      const project = ([x,y]) => {
        if (mode === 1) return [width / 2 + scale * (x - longitude) * radians, height / 2 - scale * (y - latitude) * radians];
        const q = [Math.cos(y * radians) * Math.cos(x * radians), Math.cos(y * radians) * Math.sin(x * radians), Math.sin(y * radians)];
        return [width / 2 + scale * rowX.reduce((sum,v,i) => sum + v * q[i],0), height / 2 + scale * rowY.reduce((sum,v,i) => sum + v * q[i],0)];
      };
      const reference = rings.flatMap(ring => ring.slice(0,-1).flatMap((a,index) => {
        const b = ring[index + 1], parts = 512;
        return Array.from({ length: parts }, (_v,j) => [project([a[0] + (b[0]-a[0])*j/parts, a[1] + (b[1]-a[1])*j/parts]),
          project([a[0] + (b[0]-a[0])*(j+1)/parts, a[1] + (b[1]-a[1])*(j+1)/parts])]);
      }));
      const packet = { ...buildPolygonGeometryPacket(geometry), key: `fixture-${mode}-${longitude}`, geometryRevision: 1, style: { color: '#ffffff' } };
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      const drawn = pass.drawPackets([packet], { viewport: [width,height], translate: [width/2,height/2], scale,
        rowX, rowY, rowZ, flatCenter: [lon,lat], mode, worldOffsets: [0] });
      if (!drawn.succeeded) throw new Error('Actual WebGL draw failed');
      const pixels = new Uint8Array(width * height * 4); gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let painted = 0, intrusion = 0, worst = null;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!pixels[((height-1-y)*width+x)*4+3]) continue;
        painted++;
        const px = (x+0.5-width/2)/scale, py = (y+0.5-height/2)/scale;
        let point;
        if (mode === 1) point = [longitude + px/radians, latitude - py/radians];
        else {
          const z = Math.sqrt(1-px*px-py*py), q = rowX.map((v,i) => px*v + py*rowY[i] + z*rowZ[i]);
          let lonDegrees = Math.atan2(q[1],q[0])/radians;
          while (lonDegrees - longitude < -180) lonDegrees += 360;
          point = [lonDegrees, Math.asin(q[2])/radians];
        }
        if (contains(point,rings[0]) && !contains(point,rings[1])) continue;
        let closest = Infinity;
        for (const [a,b] of reference) closest = Math.min(closest, distance([x+0.5,y+0.5],a,b));
        if (closest > intrusion) { intrusion = closest; worst = { point, pixel: [x+0.5,y+0.5] }; }
      }
      const originalProgram = gl.getParameter(gl.CURRENT_PROGRAM), probe = gl.createProgram();
      for (const shader of gl.getAttachedShaders(originalProgram)) gl.attachShader(probe, shader);
      gl.transformFeedbackVaryings(probe, ['gl_Position'], gl.INTERLEAVED_ATTRIBS); gl.linkProgram(probe);
      if (!gl.getProgramParameter(probe, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(probe));
      gl.useProgram(probe);
      setGpuViewUniforms(gl, { frameContext: { viewport: [width,height], translate: [width/2,height/2], scale,
        rowX,rowY,rowZ,flatCenter: [lon,lat],mode }, getLocation: name => gl.getUniformLocation(probe,name) });
      const input = gl.createBuffer(), output = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,input); gl.bufferData(gl.ARRAY_BUFFER,packet.positions,gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output); gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,packet.vertexCount*16,gl.STREAM_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output); gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS,0,packet.vertexCount); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD);
      const projected = new Float32Array(packet.vertexCount*4); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,projected);
      let shaderError = 0;
      for (let i=0;i<packet.vertexCount;i++) {
        const expected = project([packet.positions[i*2],packet.positions[i*2+1]]);
        shaderError = Math.max(shaderError,Math.hypot((projected[i*4]+1)*width/2-expected[0],(1-projected[i*4+1])*height/2-expected[1]));
      }
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null); gl.deleteBuffer(input);gl.deleteBuffer(output);gl.deleteProgram(probe);
      results.push({ mode, longitude, painted, intrusion, worst, maxEdge: packet.maxEdgeDegrees, shaderError });
    }
    pass.dispose();
    const legacyCanvas = document.createElement('canvas'), gl1 = legacyCanvas.getContext('webgl');
    const device1 = createRenderDevice({ gl: gl1, canvas: legacyCanvas });
    const fill1 = createGpuPolygonOverlayPass(), stroke1 = createGpuStrokeRenderer();
    if (!fill1.initialize(device1) || !stroke1.initialize(device1)) throw new Error('WebGL1 geographic shaders failed to compile');
    fill1.dispose(); stroke1.dispose(); return results;
  });
  for (const result of results) {
    expect(result.painted).toBeGreaterThan(1000);
    expect(result.intrusion, JSON.stringify(result)).toBeLessThanOrEqual(0.5);
    expect(result.shaderError, JSON.stringify(result)).toBeLessThanOrEqual(0.1);
  }
  console.log('Projected synthetic coverage:', JSON.stringify(results.map(({ mode,longitude,intrusion,shaderError }) => ({ mode,longitude,intrusion,shaderError }))));
});
