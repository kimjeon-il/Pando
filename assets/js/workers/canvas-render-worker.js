'use strict';
importScripts('../vendor/d3.min.js');

function canvasFallbackWorkerMain() {
    let canvas = null;
    let context = null;
    let features = [];
    function countryId(feature, index) {
      return String(feature.properties?.editor_id || feature.properties?.iso_a3 || index);
    }
    function render(message) {
      const width = Math.max(1, Number(message.width || 1));
      const height = Math.max(1, Number(message.height || 1));
      const dpr = Math.max(1, Number(message.dpr || 1));
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (!canvas) {
        canvas = new OffscreenCanvas(pixelWidth, pixelHeight);
        context = canvas.getContext('2d', { alpha: true });
      } else if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      if (!context) throw new Error('Canvas Worker 2D 컨텍스트를 만들 수 없습니다.');
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, pixelWidth, pixelHeight);
      if (message.visible) {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const view = message.view || {};
        let projection;
        if (message.projection === 'globe') {
          const base = Math.max(60, Math.min(width, height - 26) * 0.455);
          projection = self.d3.geo.orthographic()
            .translate([width / 2, height / 2])
            .scale(base * Number(view.globeZoom || 1))
            .rotate(view.globeRotation || [-15, -25, 0])
            .clipAngle(90)
            .precision(0.35);
        } else {
          const base = Math.max(30, width / (2 * Math.PI));
          projection = self.d3.geo.equirectangular()
            .translate([width / 2, height / 2])
            .scale(base * Number(view.flatZoom || 1))
            .center(view.flatCenter || [0, 20])
            .rotate([0, 0, 0])
            .clipExtent([[0, 0], [width, height - 25]])
            .precision(0.25);
        }
        const geoPath = self.d3.geo.path().projection(projection).context(context);
        const hiddenCountryIds = new Set((message.hiddenCountryIds || []).map(String));
        context.lineJoin = 'round';
        context.lineWidth = 0.72;
        for (let index = 0; index < features.length; index += 1) {
          const feature = features[index];
          if (hiddenCountryIds.has(countryId(feature, index))) continue;
          context.beginPath();
          geoPath(feature);
          context.globalAlpha = 0.74;
          context.fillStyle = message.colors?.[countryId(feature, index)] || feature.properties?.editor_color || '#63758a';
          context.fill();
          context.globalAlpha = 0.92;
          context.strokeStyle = '#323c46';
          context.stroke();
        }
        context.globalAlpha = 1;
      }
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({
        type: 'frame',
        revision: Number(message.revision || 0),
        bitmap,
        width: pixelWidth,
        height: pixelHeight,
      }, [bitmap]);
    }
    self.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'init') {
        features = message.features || [];
        self.postMessage({ type: 'ready' });
      } else if (message.type === 'data') {
        features = message.features || [];
        self.postMessage({ type: 'data-ready', revision: Number(message.revision || 0) });
      } else if (message.type === 'render') {
        try {
          render(message);
        } catch (error) {
          self.postMessage({ type: 'error', message: error?.message || String(error) });
        }
      }
    };
  }

canvasFallbackWorkerMain();
