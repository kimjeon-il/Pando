/** InteractionPackets: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createInteractionPackets() {
  let dependencies;
  let interactionSceneBuilder;
  let currentGpuInteractionFillItems;
  let currentGpuPreviewPackets;
  let currentGpuEditPreviewPackets;
  let currentGpuDraftPackets;
  let gpuInteractionPacketRevision;
  let gpuInteractionPacketSignatures;
  let territorialBoundaryGeometryTokens;
  let territorialBoundaryGeometryTokenSequence;
  function connect(ports) {
    if (dependencies) throw new Error('interaction-packets already connected');
    dependencies = ports;
  }

  function territorialBoundaryGeometryToken(geometry) {
    if (!geometry || typeof geometry !== 'object') return 'none';
    let token = territorialBoundaryGeometryTokens.get(geometry);
    if (!token) {
      token = String(++territorialBoundaryGeometryTokenSequence);
      territorialBoundaryGeometryTokens.set(geometry, token);
    }
    return token;
  }

  function presentationGroupForTerritorialFeature(feature) {
    return feature?.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
      ? 'subunits'
      : feature?.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION
        ? 'regions'
        : 'subunits';
  }

  function applyOverlayStackOrder() {
    if (!dependencies.overlayStackLayer) return;
    const order = dependencies.state.layerPresentation?.overlayOrder || dependencies.OVERLAY_GROUPS;
    const objectOrder = new Map((dependencies.state.layerPresentation?.objectOrder || []).map((key, index) => [key, index]));
    const groupForDatum = datum => datum?.layer
      ? dependencies.DISTRIBUTION_TYPE_GROUPS[datum.layer.type]
      : datum?.properties?.unitType
        ? presentationGroupForTerritorialFeature(datum)
        : 'genericFeatures';
    dependencies.overlayStackLayer.selectAll('[data-presentation-group]').sort((left, right) => {
      const leftGroup = groupForDatum(left);
      const rightGroup = groupForDatum(right);
      const leftIndex = order.indexOf(leftGroup);
      const rightIndex = order.indexOf(rightGroup);
      if (leftGroup === rightGroup && leftGroup === 'subunits') {
        const key = feature => `territorial:${feature?.properties?.unitType}:${feature?.id}`;
        return (objectOrder.get(key(right)) ?? objectOrder.size) - (objectOrder.get(key(left)) ?? objectOrder.size);
      }
      return (rightIndex < 0 ? order.length : rightIndex) - (leftIndex < 0 ? order.length : leftIndex);
    });
  }

  function defaultDraftInstruction() {
    const draft = (0, dependencies.editingDraftSnapshot)();
    if (draft.inputPhase === 'refine' && draft.coords.length) {
      return '꼭짓점을 드래그해 미세조정하세요.';
    }
    const inputHint = (0, dependencies.isMobile)() ? '한 손가락으로 그리세요.' : '드래그하거나 클릭해 그리세요.';
    const hydro = (0, dependencies.hydroToolConfig)(dependencies.state.tool);
    if (hydro) return `${hydro.label}의 ${(0, dependencies.isPolygonDraftTool)(dependencies.state.tool) ? '경계를' : '흐름을'} 따라 ${inputHint}`;
    if (dependencies.state.tool === 'split-generic-feature') {
      return '영역을 가로질러 경계를 그리세요.';
    }
    if (dependencies.state.tool === 'split-territorial-unit') {
      return '영역을 가로질러 경계를 그리세요.';
    }
    if (dependencies.state.tool === 'redraw-territorial-unit') return '부모 영역 안에 새 영역을 그리세요.';
    const territorySelection = dependencies.state.territorySelectionSession;
    if (territorySelection?.tool === dependencies.state.tool && territorySelection.stage === 'selection') {
      const instruction = territorySelection.draftInstructions?.[territorySelection.activeMethod];
      if (instruction) return instruction;
    }
    if (dependencies.state.distributionDraft && (0, dependencies.isPolygonDraftTool)(dependencies.state.tool)) return '분포 영역을 지도에서 지정하세요.';
    return inputHint;
  }

  function syncGenericDraftFeedback() {
    if (!dependencies.editingDomain?.draftInputActive?.() || (0, dependencies.activeCutDraftSourceGeometry)()) return;
    const issue = (0, dependencies.editingDraftSnapshot)().issues[0];
    (0, dependencies.setModeBanner)(issue?.message || defaultDraftInstruction());
    if (issue) (0, dependencies.$)('modeTaskInstruction')?.classList.add('cut-invalid');
  }

  function gpuInteractionColor(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === 'none' || text === 'transparent') return null;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
    if (hex) {
      const raw = hex[1];
      const expanded = raw.length === 3 ? raw.split('').map(part => `${part}${part}`).join('') : raw;
      return {
        color: `#${expanded.slice(0, 6)}`,
        alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1,
      };
    }
    const rgb = /^rgba?\((.+)\)$/i.exec(text);
    if (rgb) {
      const parts = rgb[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
      if (parts.length >= 3) {
        const channel = part => Math.max(0, Math.min(255, part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part)));
        const values = parts.slice(0, 3).map(channel);
        if (values.every(Number.isFinite)) {
          return {
            color: `#${values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`,
            alpha: Math.max(0, Math.min(1, Number.parseFloat(parts[3] ?? '1'))),
          };
        }
      }
    }
    const srgb = /^color\(srgb\s+(.+)\)$/i.exec(text);
    if (srgb) {
      const parts = srgb[1].replace(/\//g, ' ').split(/\s+/).filter(Boolean).map(Number);
      if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
        return {
          color: `#${parts.slice(0, 3).map(value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')).join('')}`,
          alpha: Math.max(0, Math.min(1, Number.isFinite(parts[3]) ? parts[3] : 1)),
        };
      }
    }
    return null;
  }

  function gpuInteractionGeometry(datum) {
    const geometry = datum?.type === 'Feature'
      ? datum.geometry
      : datum?.type === 'FeatureCollection'
        ? null
        : datum?.geometry?.type
          ? datum.geometry
          : ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(datum?.type)
            ? datum
            : null;
    return ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geometry?.type) ? geometry : null;
  }

  function gpuInteractionStyle(node, role) {
    const computed = getComputedStyle(node);
    const opacity = Math.max(0, Math.min(1, Number.parseFloat(computed.opacity || '1')));
    const source = gpuInteractionColor(role === 'fill' ? computed.fill : computed.stroke);
    if (!source) return null;
    const roleOpacity = Math.max(0, Math.min(1, Number.parseFloat(role === 'fill' ? computed.fillOpacity : computed.strokeOpacity) || 0));
    const alpha = source.alpha * opacity * roleOpacity;
    if (alpha <= 0.0001) return null;
    if (role === 'fill') {
      return {
        color: source.color,
        alpha,
        fillAlpha: alpha,
        blendMode: computed.mixBlendMode === 'multiply' ? 'multiply' : 'normal',
      };
    }
    const dash = String(computed.strokeDasharray || '').toLowerCase() === 'none'
      ? [0, 0]
      : String(computed.strokeDasharray || '').split(/[\s,]+/).filter(Boolean).slice(0, 2).map(value => Math.max(0, Number.parseFloat(value) || 0));
    return {
      color: source.color,
      alpha,
      width: Math.max(0, Number.parseFloat(computed.strokeWidth || '0')),
      cap: computed.strokeLinecap === 'butt' ? 'butt' : 'round',
      join: ['round', 'bevel', 'miter'].includes(computed.strokeLinejoin) ? computed.strokeLinejoin : 'round',
      dash: dash.length === 2 ? dash : [0, 0],
      miterLimit: Math.max(1, Number.parseFloat(computed.strokeMiterlimit || '4') || 4),
      blendMode: computed.mixBlendMode === 'multiply' ? 'multiply' : 'normal',
    };
  }

  function buildGpuInteractionLayerPackets(domain, layer) {
    const polygons = [];
    const strokes = [];
    const nodes = layer?.selectAll?.('path')?.nodes?.() || [];
    nodes.forEach((node, index) => {
      if (node.classList.contains('draft-segment-hit') || node.closest('.draft-issue-marker')) return;
      const geometry = gpuInteractionGeometry(node.__data__);
      if (!geometry) return;
      const objectKey = `interaction:${domain}:${index}`;
      const revision = (0, dependencies.selectionGeometryRevision)(objectKey, domain, (0, dependencies.featureFromGeometry)(geometry));
      const resourceKeys = [];
      const fillStyle = ['Polygon', 'MultiPolygon'].includes(geometry.type) ? gpuInteractionStyle(node, 'fill') : null;
      if (fillStyle) {
        const key = `${objectKey}:fill`;
        resourceKeys.push(key);
        polygons.push({ key, geometry, geometryRevision: revision, order: index * 2, style: fillStyle, blendMode: fillStyle.blendMode });
      }
      const strokeStyle = gpuInteractionStyle(node, 'stroke');
      if (strokeStyle?.width > 0) {
        const key = `${objectKey}:stroke`;
        resourceKeys.push(key);
        strokes.push({ key, geometry, geometryRevision: revision, order: index * 2 + 1, style: strokeStyle, blendMode: strokeStyle.blendMode });
      }
      if (resourceKeys.length) node.setAttribute('data-gpu-interaction-keys', resourceKeys.join(' '));
    });
    const scene = interactionSceneBuilder.build({
      revision: ++gpuInteractionPacketRevision,
      polygons,
      strokes,
    });
    return [
      ...scene.polygons.map(packet => ({ kind: 'polygon', packet })),
      ...scene.strokes.map(packet => ({ kind: 'stroke', packet })),
    ].sort((left, right) => Number(left.packet.order || 0) - Number(right.packet.order || 0));
  }

  function syncGpuInteractionLayer(domain, layer) {
    const packets = buildGpuInteractionLayerPackets(domain, layer);
    const signature = packets.map(({ kind, packet }) => `${kind}:${packet.key}:${packet.geometryRevision}:${JSON.stringify(packet.style)}`).join('|');
    if (gpuInteractionPacketSignatures[domain] === signature) return false;
    gpuInteractionPacketSignatures[domain] = signature;
    if (domain === 'preview') currentGpuPreviewPackets = packets;
    else currentGpuDraftPackets = packets;
    (0, dependencies.syncGpuInteractionState)();
    dependencies.renderingDomain?.invalidateGpuInteraction?.(`gpu-${domain}-packets`);
    return true;
  }

  function initializeInteractionSceneBuilder() {
    (interactionSceneBuilder = (0, dependencies.createRenderSceneBuilder)({ triangulate: (...args) => window.earcut(...args), cacheLimit: 256 }));
  }

  function initializeCurrentGpuInteractionFillItems() {
    (currentGpuInteractionFillItems = []);

    (currentGpuPreviewPackets = []);

    (currentGpuEditPreviewPackets = []);

    (currentGpuDraftPackets = []);

    (gpuInteractionPacketRevision = 0);

    (gpuInteractionPacketSignatures = { preview: '', draft: '' });
  }

  function initializeTerritorialBoundaryGeometryTokens() {
    (territorialBoundaryGeometryTokens = new WeakMap());

    (territorialBoundaryGeometryTokenSequence = 0);
  }

  return Object.freeze({
    connect,
    initializeInteractionSceneBuilder,
    initializeCurrentGpuInteractionFillItems,
    initializeTerritorialBoundaryGeometryTokens,
    get applyOverlayStackOrder() { return applyOverlayStackOrder; },
    get currentGpuDraftPackets() { return currentGpuDraftPackets; },
    get currentGpuEditPreviewPackets() { return currentGpuEditPreviewPackets; },
    set currentGpuEditPreviewPackets(value) { currentGpuEditPreviewPackets = value; },
    get currentGpuInteractionFillItems() { return currentGpuInteractionFillItems; },
    set currentGpuInteractionFillItems(value) { currentGpuInteractionFillItems = value; },
    get currentGpuPreviewPackets() { return currentGpuPreviewPackets; },
    get defaultDraftInstruction() { return defaultDraftInstruction; },
    get presentationGroupForTerritorialFeature() { return presentationGroupForTerritorialFeature; },
    get syncGenericDraftFeedback() { return syncGenericDraftFeedback; },
    get syncGpuInteractionLayer() { return syncGpuInteractionLayer; },
    get territorialBoundaryGeometryToken() { return territorialBoundaryGeometryToken; },
  });
}
