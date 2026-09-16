import { interactionNodeRole, interactionRoleStyle, resolveMapInteractionStyle, INTERACTION_ROLE_PRIORITY } from './map-interaction-style.js';
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
    if (!dependencies.mapLayers.overlayStackLayer) return;
    const order = dependencies.state.layerPresentation?.overlayOrder || dependencies.renderScene.OVERLAY_GROUPS;
    const objectOrder = new Map((dependencies.state.layerPresentation?.objectOrder || []).map((key, index) => [key, index]));
    const groupForDatum = datum => datum?.layer
      ? dependencies.distributionPresentation.DISTRIBUTION_TYPE_GROUPS[datum.layer.type]
      : datum?.properties?.unitType
        ? presentationGroupForTerritorialFeature(datum)
        : 'genericFeatures';
    dependencies.mapLayers.overlayStackLayer.selectAll('[data-presentation-group]').sort((left, right) => {
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
    const draft = (0, dependencies.draftPresentation.editingDraftSnapshot)();
    if (draft.inputPhase === 'refine' && draft.coords.length) {
      return '꼭짓점을 드래그해 미세조정하세요.';
    }
    const inputHint = (0, dependencies.surfaces.isMobile)() ? '한 손가락으로 그리세요.' : '드래그하거나 클릭해 그리세요.';
    const hydro = (0, dependencies.draftPresentation.hydroToolConfig)(dependencies.state.tool);
    if (hydro) return `${hydro.label}의 ${(0, dependencies.surfaces.isPolygonDraftTool)(dependencies.state.tool) ? '경계를' : '흐름을'} 따라 ${inputHint}`;
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
    if (dependencies.state.distributionDraft && (0, dependencies.surfaces.isPolygonDraftTool)(dependencies.state.tool)) return '분포 영역을 지도에서 지정하세요.';
    return inputHint;
  }

  function syncGenericDraftFeedback() {
    if (!dependencies.domains.editingDomain?.draftInputActive?.() || (0, dependencies.draftPresentation.activeCutDraftSourceGeometry)()) return;
    const issue = (0, dependencies.draftPresentation.editingDraftSnapshot)().issues[0];
    (0, dependencies.draftPresentation.setModeBanner)(issue?.message || defaultDraftInstruction());
    if (issue) (0, dependencies.$)('modeTaskInstruction')?.classList.add('cut-invalid');
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

  function gpuInteractionStyle(node, channel, domain) {
    const role = interactionNodeRole(node, domain);
    if (channel === 'stroke' && (node.classList.contains('geometry-preview-fill') || node.dataset.commonOutline === 'true')) return null;
    const directManipulation = node.classList.contains('draft-shape');
    const style = interactionRoleStyle(dependencies.preferences.resolvedInteractionStyle || resolveMapInteractionStyle(), role, { directManipulation });
    node.style.fill = style.color;
    node.style.fillOpacity = String(style.fillAlpha);
    node.style.stroke = style.color;
    node.style.strokeWidth = `${style.width}px`;
    node.style.strokeOpacity = String(style.alpha);
    node.style.opacity = '1';
    if (channel === 'fill') return style.fillAlpha > 0 ? { color: style.color, fillAlpha: style.fillAlpha, blendMode: 'normal' } : null;
    return { color: style.color, alpha: style.alpha, width: style.width, cap: 'round', join: 'round', dash: [0, 0], blendMode: 'normal' };
  }

  function buildGpuInteractionLayerPackets(domain, layer) {
    const polygons = [];
    const strokes = [];
    const nodes = layer?.selectAll?.('path')?.nodes?.() || [];
    nodes.forEach((node, index) => {
      if (node.classList.contains('draft-segment-hit') || node.closest('.draft-issue-marker')) return;
      const geometry = gpuInteractionGeometry(node.__data__);
      if (!geometry) return;
      const objectKey = `interaction:${domain}:${node.__data__?.key ?? node.__data__?.index ?? index}`;
      const priority = INTERACTION_ROLE_PRIORITY[interactionNodeRole(node, domain)];
      node.setAttribute('data-object-key', objectKey);
      node.setAttribute('data-interaction-priority', String(priority));
      const revision = (0, dependencies.renderScene.selectionGeometryRevision)(objectKey, domain, (0, dependencies.renderScene.featureFromGeometry)(geometry));
      const resourceKeys = [];
      node.classList.remove('gpu-interaction-hit-proxy', 'gpu-interaction-fill-proxy', 'gpu-interaction-stroke-proxy', 'canvas-interaction-fill-proxy');
      node.removeAttribute('data-gpu-interaction-stroke-keys');
      node.removeAttribute('data-gpu-interaction-fill-keys');
      node.removeAttribute('data-gpu-interaction-keys');
      const fillStyle = ['Polygon', 'MultiPolygon'].includes(geometry.type) ? gpuInteractionStyle(node, 'fill', domain) : null;
      if (fillStyle) {
        const key = `${objectKey}:fill`;
        resourceKeys.push(key);
        node.setAttribute('data-gpu-interaction-fill-keys', key);
        polygons.push({ key, geometry, geometryRevision: revision, order: index * 2, role: 'interaction-fill', interactionPriority: priority, style: fillStyle, blendMode: fillStyle.blendMode });
      }
      const strokeStyle = gpuInteractionStyle(node, 'stroke', domain);
      if (strokeStyle?.width > 0) {
        const key = `${objectKey}:stroke`;
        resourceKeys.push(key);
        node.setAttribute('data-gpu-interaction-stroke-keys', key);
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
    (0, dependencies.renderScene.syncGpuInteractionState)();
    dependencies.domains.renderingDomain?.invalidateGpuInteraction?.(`gpu-${domain}-packets`);
    return true;
  }

  function initializeInteractionSceneBuilder() {
    (interactionSceneBuilder = (0, dependencies.renderScene.createRenderSceneBuilder)({ triangulate: (...args) => window.earcut(...args), cacheLimit: 256 }));
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
