import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

test('real WebGL 1/2 compile and link SDF color and pick shaders without changing hydro IDs', async ({ page }) => {
  await page.route(/hydro-sdf-fixture$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Hydro SDF GPU</title>' }));
  await page.goto('/hydro-sdf-fixture');
  const reports = await page.evaluate(async () => {
    const { hydroSdfShaderSources } = await import('/assets/js/modules/gpu-hydro-sdf.js');
    const { createGpuHydroCoverage } = await import('/assets/js/modules/gpu-hydro-coverage.js');
    const { linkGpuProgram } = await import('/assets/js/modules/gpu-shader-utils.js');
    const output = [];
    for (const version of [2, 1]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      document.body.append(canvas);
      const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', {
        alpha: true, stencil: true, antialias: false, preserveDrawingBuffer: true,
      });
      if (!gl) { output.push({ version, available: false }); continue; }
      const sources = hydroSdfShaderSources(version);
      let color = null, pick = null;
      try {
        color = linkGpuProgram(gl, sources.vertex, sources.fragment, { label: `hydro-sdf-color-gl${version}` });
        pick = linkGpuProgram(gl, sources.vertex, sources.pick, { label: `hydro-sdf-pick-gl${version}` });
        const coverage = createGpuHydroCoverage();
        coverage.setContext(gl, version);
        const union = coverage.render({ width: 128, height: 128, color: [0.1, 0.4, 0.9, 0.65], paint() {} });
        const error = gl.getError();
        output.push({ version, available: true, compiled: true, union, error,
          supported: coverage.stats().maximumBlend });
        coverage.dispose();
      } catch (error) {
        output.push({ version, available: true, compiled: false, message: String(error) });
      } finally {
        if (color) gl.deleteProgram(color);
        if (pick) gl.deleteProgram(pick);
        canvas.remove();
      }
    }
    return output;
  });
  expect(reports).toHaveLength(2);
  for (const row of reports) {
    expect(row.available, `WebGL${row.version}`).toBe(true);
    expect(row.compiled, `${row.message || 'shader compilation'}`).toBe(true);
    expect(row.error).toBe(0);
    if (row.supported) expect(row.union).toBe(true);
  }
  expect(reports[0].supported, 'WebGL2 has MAX blending').toBe(true);
});
