import { INTERACTION_ROLE_PRIORITY } from "../../../../../shared/frontend/js/modules/layer-presentation.js";
import { interactionNodeRole, resolveMapStrokeStyle, resolveMapInteractionStyle } from "../../../../../shared/frontend/js/modules/map-interaction-style.js";
import { applySvgInteractionOwnership } from "../../../../../shared/frontend/js/modules/render-channel-ownership.js";
import { createGpuMeshWorkerJobs } from "../../../../../shared/frontend/js/modules/gpu-mesh-worker-jobs.js";
import { geometryRevisionKey } from "../../../../../shared/frontend/js/modules/geometry-versions.js";
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
  const interactionInputs = new Map(), interactionLayers = new Map();
  let pendingPreparation = null;
  function connect(ports) {
    if (dependencies) throw new Error('interaction-packets already connected');
    dependencies = ports;
  }

  function territorialBoundaryGeometryToken(geometry) {
    return geometryRevisionKey(geometry);
  }

  function applyOverlayStackOrder() {
    if (!dependencies.mapLayers.overlayStackLayer) return;
    const order = dependencies.projectState.state.layerPresentation?.overlayOrder || dependencies.renderScene.OVERLAY_GROUPS;
    const objectOrder = new Map((dependencies.projectState.state.layerPresentation?.objectOrder || []).map((key, index) => [key, index]));
    const groupForDatum = datum => datum?.layer
      ? 'distributions'
      : datum?.properties?.entityKind
        ? 'objects'
        : 'genericFeatures';
    dependencies.mapLayers.overlayStackLayer.selectAll('[data-presentation-group]').sort((left, right) => {
      const leftGroup = groupForDatum(left);
      const rightGroup = groupForDatum(right);
      const leftIndex = order.indexOf(leftGroup);
      const rightIndex = order.indexOf(rightGroup);
      if (leftGroup === rightGroup && leftGroup === 'objects') {
        const key = feature => `territorial:entity:${feature?.id}`;
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
    const hydro = (0, dependencies.draftPresentation.hydroToolConfig)(dependencies.projectState.state.tool);
    if (hydro) return `${hydro.label}의 ${(0, dependencies.surfaces.isPolygonDraftTool)(dependencies.projectState.state.tool) ? '경계를' : '흐름을'} 따라 ${inputHint}`;
    if (dependencies.projectState.state.tool === 'split-generic-feature') {
      return '영역을 가로질러 경계를 그리세요.';
    }
    if (dependencies.projectState.state.tool === 'split-territorial-unit') {
      return '영역을 가로질러 경계를 그리세요.';
    }
    if (dependencies.projectState.state.tool === 'redraw-territorial-unit') return '부모 영역 안에 새 영역을 그리세요.';
    const territorySelection = dependencies.projectState.state.territorySelectionSession;
    if (territorySelection?.tool === dependencies.projectState.state.tool && territorySelection.stage === 'selection') {
      const instruction = territorySelection.draftInstructions?.[territorySelection.activeMethod];
      if (instruction) return instruction;
    }
    if (dependencies.projectState.state.distributionDraft && (0, dependencies.surfaces.isPolygonDraftTool)(dependencies.projectState.state.tool)) return '분포 영역을 지도에서 지정하세요.';
    return inputHint;
  }

  function syncGenericDraftFeedback() {
    if (!dependencies.domains.editingDomain?.draftInputActive?.() || (0, dependencies.draftPresentation.activeCutDraftSourceGeometry)()) return;
    const issue = (0, dependencies.draftPresentation.editingDraftSnapshot)().issues[0];
    (0, dependencies.draftPresentation.setModeBanner)(issue?.message || defaultDraftInstruction());
    if (issue) (0, dependencies.platform.$)('modeTaskInstruction')?.classList.add('cut-invalid');
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
    const style = resolveMapStrokeStyle(dependencies.preferences.resolvedInteractionStyle || resolveMapInteractionStyle(), role, { directManipulation });
    node.style.fillOpacity = String(style.fillAlpha);
    node.style.strokeWidth = `${style.width}px`;
    node.style.strokeOpacity = String(style.alpha);
    node.style.opacity = '1';
    if (channel === 'fill') return style.fillAlpha > 0 ? { color: style.color, fillAlpha: style.fillAlpha, blendMode: 'normal' } : null;
    return style;
  }

  function buildGpuInteractionLayerPackets(domain, layer) {
    const polygons = [];
    const strokes = [];
    const nodes = [];
    layer?.selectAll?.('path')?.each?.(function() { nodes.push(this); });
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
    const input = {
      revision: ++gpuInteractionPacketRevision,
      projection: dependencies.projectState.state.projection,
      polygons,
      strokes,
    };
    interactionInputs.set(domain, input); interactionLayers.set(domain, layer);
    const polygonStrokes = items => items.filter(item =>
      item.geometry?.type === 'Polygon' || item.geometry?.type === 'MultiPolygon');
    const allPolygons = [...interactionInputs.values()].flatMap(value =>
      [...value.polygons, ...polygonStrokes(value.strokes)]);
    const missing = interactionSceneBuilder.missingPolygons(allPolygons, input);
    if (missing.length) {
      const signature = missing.map(item => item.cacheKey).join('|');
      if (pendingPreparation?.signature !== signature) {
        const builder = interactionSceneBuilder, pending = { signature };
        pendingPreparation = pending;
        builder.preparePolygons(allPolygons, input).then(() => {
          if (pendingPreparation !== pending || builder !== interactionSceneBuilder) return;
          pendingPreparation = null;
          for (const [name, currentLayer] of interactionLayers) syncGpuInteractionLayer(name, currentLayer);
          builder.releasePrepared();
        }).catch(error => {
          if (pendingPreparation !== pending) return;
          pending.failed = true;
          if (!error.cancelled && error.name !== 'AbortError')
            dependencies.feedback.reportOperationError(error, '편집 미리보기 면을 준비하지 못했습니다.', 'PL-MESH-PREPARE', 4200);
        });
      }
      if (interactionSceneBuilder.missingPolygons([...polygons, ...polygonStrokes(strokes)], input).length) return [];
    } else if (pendingPreparation) {
      pendingPreparation = null; interactionSceneBuilder.cancelPreparation();
    }
    const scene = interactionSceneBuilder.build(input);
    return [
      ...scene.polygons.map(packet => ({ kind: 'polygon', packet })),
      ...scene.strokes.map(packet => ({ kind: 'stroke', packet })),
    ].sort((left, right) => Number(left.packet.order || 0) - Number(right.packet.order || 0));
  }

  function syncGpuInteractionLayer(domain, layer) {
    const packets = buildGpuInteractionLayerPackets(domain, layer);
    const signature = packets.map(({ kind, packet }) => `${kind}:${packet.key}:${packet.geometryRevision}:${JSON.stringify(packet.style)}`).join('|');
    if (gpuInteractionPacketSignatures[domain] === signature) return false;
    // A rejoin of the same packets must not expose SVG over an already painted
    // GPU frame. New geometry/style returns to SVG until its channels complete.
    layer?.selectAll?.('[data-gpu-interaction-keys]')?.each(function() { applySvgInteractionOwnership(this); });
    gpuInteractionPacketSignatures[domain] = signature;
    if (domain === 'preview') currentGpuPreviewPackets = packets;
    else currentGpuDraftPackets = packets;
    (0, dependencies.renderScene.syncGpuInteractionState)();
    dependencies.domains.renderingDomain?.invalidateGpuInteraction?.(`gpu-${domain}-packets`);
    return true;
  }

  function initializeInteractionSceneBuilder() {
    interactionSceneBuilder?.clear(); pendingPreparation = null;
    interactionInputs.clear(); interactionLayers.clear();
    (interactionSceneBuilder = (0, dependencies.renderScene.createRenderSceneBuilder)({ cacheLimit: 256,
      meshJobs: createGpuMeshWorkerJobs({ isCurrent: () => true,
        createWorker: () => new Worker(dependencies.platform.runtimeAssetUrl('workers/gpu-mesh-worker.js'), { name: 'pandolab-interaction-mesh' }) }) }));
  }

  function initializeCurrentGpuInteractionFillItems() {
    (currentGpuInteractionFillItems = []);

    (currentGpuPreviewPackets = []);

    (currentGpuEditPreviewPackets = []);

    (currentGpuDraftPackets = []);

    (gpuInteractionPacketRevision = 0);

    (gpuInteractionPacketSignatures = { preview: '', draft: '' });
  }

  return Object.freeze({
    connect,
    initializeInteractionSceneBuilder,
    initializeCurrentGpuInteractionFillItems,
    get applyOverlayStackOrder() { return applyOverlayStackOrder; },
    get currentGpuDraftPackets() { return currentGpuDraftPackets; },
    get currentGpuEditPreviewPackets() { return currentGpuEditPreviewPackets; },
    set currentGpuEditPreviewPackets(value) { currentGpuEditPreviewPackets = value; },
    get currentGpuInteractionFillItems() { return currentGpuInteractionFillItems; },
    set currentGpuInteractionFillItems(value) { currentGpuInteractionFillItems = value; },
    get currentGpuPreviewPackets() { return currentGpuPreviewPackets; },
    get defaultDraftInstruction() { return defaultDraftInstruction; },
    get syncGenericDraftFeedback() { return syncGenericDraftFeedback; },
    get syncGpuInteractionLayer() { return syncGpuInteractionLayer; },
    get territorialBoundaryGeometryToken() { return territorialBoundaryGeometryToken; },
  });
}
