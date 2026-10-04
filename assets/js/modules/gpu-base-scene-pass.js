import { resetGpuNormalBlend } from './gpu-blend-utils.js';

// Submits a prepared frame. All resource construction and range scans happen before entry.
export function drawGpuBaseScene({ gl, frame: activeFrameContext, width: pixelWidth, height: pixelHeight,
  terrainVisible, terrainStyle, terrainRepresentation, countriesVisible, mapSubstrate, countries, prepared },
  { drawProgram, renderTerrain, drawHydro, drawCountryBoundaryStrokes, polygonOverlayPass, strokeRenderer }) {
  const { mesh, overrideMesh, dynamicResources, landMaskProgram, fillProgram, fillVao, fillIndexBuffer, overrideFillVao, overrideFillIndexBuffer, paletteTexture, overridePaletteTexture } = countries;
  const { baseTriangleDraw, baseBoundaryDraw, overrideTriangleDraw, overrideBoundaryDraw,
    territoryItems, independentItems, deferredOverlayKeys, failedOverlayKeys } = prepared;
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      // Map-mode substrate is independent of optional country paint.
      resetGpuNormalBlend(gl);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(0xff);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      for (const { packet } of territoryItems) {
        if (!deferredOverlayKeys.has(String(packet.key)) && !failedOverlayKeys.has(String(packet.key))) {
          polygonOverlayPass.drawPackets([{ ...packet, blendMode: 'normal', style: mapSubstrate }], activeFrameContext, { preparedOnly: true });
        }
      }
      if (countriesVisible) {
        drawProgram(fillProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES, null, paletteTexture, null, null, baseTriangleDraw.ranges, true);
        if (overrideMesh?.triangleIndices?.length) drawProgram(fillProgram, overrideFillVao, overrideFillIndexBuffer, overrideMesh.triangleIndices.length, gl.TRIANGLES, dynamicResources, overridePaletteTexture, null, null, overrideTriangleDraw.ranges, true);
      }
      gl.disable(gl.STENCIL_TEST);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.disable(gl.BLEND);
      if (terrainVisible && (terrainStyle !== 'physical' || terrainRepresentation === 'dem-relief-v1')) {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.colorMask(false, false, false, false);
        drawProgram(landMaskProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES, null, paletteTexture, null, null, baseTriangleDraw.ranges);
        if (overrideMesh?.triangleIndices?.length) drawProgram(landMaskProgram, overrideFillVao, overrideFillIndexBuffer, overrideMesh.triangleIndices.length, gl.TRIANGLES, dynamicResources, overridePaletteTexture, null, null, overrideTriangleDraw.ranges);
        // General descendants may have explicit land outside the root polygon.
        // Consume the same prepared display geometry without clipping/editing it.
        // Independent regional overlays are absent from territoryItems.
        for (const { packet } of territoryItems) {
          if (!deferredOverlayKeys.has(String(packet.key)) && !failedOverlayKeys.has(String(packet.key))) {
            polygonOverlayPass.drawPackets([packet], activeFrameContext, { claimTransparent: true, preparedOnly: true });
          }
        }
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0x00);
        if (terrainStyle === 'physical' && terrainRepresentation === 'dem-relief-v1') {
          gl.stencilFunc(gl.NOTEQUAL, 1, 0xff);
          renderTerrain('ocean');
        }
        gl.stencilFunc(gl.EQUAL, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        renderTerrain('land');
        gl.disable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
      } else {
        renderTerrain();
      }
      const overlayRenderedKeys = [];
      const overlayMissingKeys = [];
      const drawOverlay = item => {
        const pass = item.kind === 'polygon' ? polygonOverlayPass : strokeRenderer;
        if (deferredOverlayKeys.has(String(item.packet.key)) || failedOverlayKeys.has(String(item.packet.key)) || !pass.hasResource?.(item.packet.key)) {
          overlayMissingKeys.push(String(item.packet.key));
          return;
        }
        const result = item.kind === 'polygon'
          ? polygonOverlayPass.drawPackets([item.packet], activeFrameContext, { claimTransparent: item.packet.role === 'territorial-fill', preparedOnly: true })
          : strokeRenderer.drawBatches([item.packet], activeFrameContext, { preparedOnly: true });
        overlayRenderedKeys.push(...(result?.renderedKeys || []));
        overlayMissingKeys.push(...(result?.missingKeys || []));
      };
      // Front-to-back ownership: each sample receives exactly one territorial
      // fill, regardless of nesting, alpha, or the number of overlapping units.
      gl.stencilMask(0xff);
      gl.clearStencil(0);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      for (const item of territoryItems) drawOverlay(item);
      resetGpuNormalBlend(gl);
      if (countriesVisible) {
        drawProgram(fillProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES, null, paletteTexture, null, null, baseTriangleDraw.ranges);
        if (overrideMesh?.triangleIndices?.length) drawProgram(fillProgram, overrideFillVao, overrideFillIndexBuffer, overrideMesh.triangleIndices.length, gl.TRIANGLES, dynamicResources, overridePaletteTexture, null, null, overrideTriangleDraw.ranges);
      }
      gl.disable(gl.STENCIL_TEST);
      resetGpuNormalBlend(gl);
      drawHydro('lake');
      drawHydro('lake-boundary');
      drawHydro('river');
      drawHydro('border-river');
      const countryStrokeResult = drawCountryBoundaryStrokes(dynamicResources, baseBoundaryDraw, overrideBoundaryDraw);
      // Reserve base water and borders, then submit every independent visual
      // in scene order. Only fills are clipped by these protected pixels.
      if (independentItems.some(item => item.kind === 'polygon')) {
        gl.stencilMask(0xff);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.enable(gl.STENCIL_TEST);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.colorMask(false, false, false, false);
        drawHydro('lake');
        drawHydro('lake-boundary');
        drawHydro('river');
        drawHydro('border-river');
        drawCountryBoundaryStrokes(dynamicResources, baseBoundaryDraw, overrideBoundaryDraw);
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0x00);
        gl.stencilFunc(gl.EQUAL, 0, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      }
      for (const item of independentItems) {
        if (item.kind === 'polygon') gl.enable(gl.STENCIL_TEST);
        else gl.disable(gl.STENCIL_TEST);
        drawOverlay(item);
      }
      gl.disable(gl.STENCIL_TEST);
      gl.stencilMask(0xff);

  return { overlayRenderedKeys, overlayMissingKeys, countryStrokeResult };
}
