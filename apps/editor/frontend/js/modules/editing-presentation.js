import {EMPTY_EDITING_RENDER_PACKET} from './editing-render-packet.js';
import {boundaryViewBounds,queryBoundaryDisplay} from './boundary-display.js';
import {resolveMapStrokeStyle,resolveMapInteractionStyle,interactionNodeRole,interactionStrokeScale,scaleInteractionStroke} from "../../../../../shared/frontend/js/modules/map-interaction-style.js";
/** Only the editor registers draft, vertex, validation and edit pointer surfaces. */
export function createEditingPresentation({active,editing,interaction,selection,context,requireFrame,framePath,frameProjectCoordinate,
 getPacket,emitEditingInteraction,reportEditingOperationError}){
 let editingGestureSequence=0;
  const presentationCache = new Map();
  const editingChannelChanged = (name, layer, ...parts) => {
    const previous = presentationCache.get(name);
    if (previous && previous.layer === layer && previous.generation === getPacket().projectGeneration
      && previous.parts.length === parts.length && parts.every((part, i) => part === previous.parts[i])) return false;
    presentationCache.set(name, { layer, parts, generation: getPacket().projectGeneration });
    return true;
  };
  const joinEditingNodes = (layer, selector, data, key) => {
    const binding = layer.selectAll(selector).data(data, key);
    binding.exit().remove();
    const [tag, className] = selector.split('.');
    binding.enter().append(tag).attr('class', className);
    return layer.selectAll(selector);
  };
  const componentProjectionCache = new WeakMap();
  const reprojectEditingLayer = (layer, frame) => {
    const path = framePath(frame);
    layer?.selectAll('path').each(function(d) {
      if (this.hasAttribute('data-interaction-priority')) {
        const directManipulation = this.classList.contains('draft-shape') || this.classList.contains('draft-auto-close-preview');
        const style = scaleInteractionStroke(resolveMapStrokeStyle(
          selection.resolvedInteractionStyle?.() || selection.getInteractionStyle?.() || resolveMapInteractionStyle(),
          interactionNodeRole(this, this.closest('[data-interaction-domain]')?.getAttribute('data-interaction-domain') || 'draft'),
          { directManipulation },
        ), frame);
        this.style.strokeWidth = `${style.width}px`;
      }
      const geometry = d?.geometry || (d?.start && d?.end ? { type: 'LineString', coordinates: [d.start, d.end] } : null);
      if (geometry) {
        const cacheable = this.classList.contains('territory-component') && Object.isFrozen(geometry)
          && frame?.viewRevision != null && frame?.projectionRevision != null;
        const cached = cacheable && componentProjectionCache.get(this);
        if (cached && cached.geometry === geometry && cached.view === frame.viewRevision
          && cached.projection === frame.projectionRevision) return;
        this.setAttribute('d', path({ type: 'Feature', properties: {}, geometry }) || '');
        if (cacheable) componentProjectionCache.set(this, { geometry, view: frame.viewRevision, projection: frame.projectionRevision });
      }
    });
    layer?.selectAll('g, circle, path.snap-indicator-cross').each(function(d) {
      if (this.parentNode !== layer.node?.() && (this.parentNode?.__data__?.coordinate || this.parentNode?.__data__?.coord)) return;
      const coordinate = d?.coordinate || d?.coord;
      if (!coordinate) return;
      const point = frameProjectCoordinate(coordinate, frame);
      this.style.visibility = point ? '' : 'hidden';
      if (!point) return;
      if (this.tagName.toLowerCase() === 'circle') {
        this.removeAttribute('transform');
        this.setAttribute('cx', point[0]); this.setAttribute('cy', point[1]);
      } else if (this.classList.contains('snap-indicator-cross')) {
        this.setAttribute('d', `M${point[0] - 7},${point[1] - 7}L${point[0] + 7},${point[1] + 7}M${point[0] + 7},${point[1] - 7}L${point[0] - 7},${point[1] + 7}`);
      } else this.setAttribute('transform', `translate(${point[0]},${point[1]})`);
    });
    return true;
  };
  const publishEditingInteraction = async event => {
    const packet = getPacket() || null;
    const normalized = Object.freeze({
      ...event,
      territorySourceKey: event?.territorySourceKey ?? packet.territoryOperation?.sourceKey,
      projectGeneration: Number(event?.projectGeneration ?? packet.projectGeneration ?? 0),
      packetRevision: Number(event?.packetRevision ?? packet.revision ?? 0),
      screenPoint: Array.isArray(event?.screenPoint)
        ? Object.freeze([Number(event.screenPoint[0]), Number(event.screenPoint[1])])
        : null,
      targetRef: event?.targetRef ? Object.freeze({ ...event.targetRef }) : null,
      modifiers: event?.modifiers ? Object.freeze({ ...event.modifiers }) : null,
    });
    if (typeof emitEditingInteraction === 'function') {
      try { return await emitEditingInteraction(normalized); }
      catch (error) { reportEditingOperationError(error,{ type: normalized.type });return false; }
    }
    context?.publish?.('editing-interaction', normalized);
    return true;
  };
  const pointerMetadata = sourceEvent => ({
    pointerType: sourceEvent?.pointerType || (sourceEvent?.touches ? 'touch' : 'mouse'),
    modifiers: {
      altKey: sourceEvent?.altKey === true,
      ctrlKey: sourceEvent?.ctrlKey === true,
      metaKey: sourceEvent?.metaKey === true,
      shiftKey: sourceEvent?.shiftKey === true,
    },
  });
  const localEditingPoint = () => interaction.d3?.mouse?.(interaction.svg?.node?.() || interaction.svg) || null;
  const touchBindings = new WeakMap();
  const bindTouchVertex = (node, kind, row, targetRef, rows, frame) => {
    if (!editing.isMobile?.()) return;
    let binding = touchBindings.get(node);
    if (binding) { Object.assign(binding, { kind, row, targetRef, rows, frame }); return; }
    binding = { kind, row, targetRef, rows, frame }; touchBindings.set(node, binding);
    let pointer = null, start = null, moving = false, cancelled = false, epoch = 0, gesture = '', choices = [];
    let chain = Promise.resolve();
    const point = event => {
      const rect = (interaction.svg?.node?.() || interaction.svg).getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const dispatch = (suffix, p) => {if(suffix!=='select'&&epoch!==editing.inputRevision())return publishEditingInteraction({type:'gesture-cancel'});return publishEditingInteraction({
      type: binding.kind + '-' + suffix, gestureId: gesture, targetRef: binding.targetRef,packetRevision:editing.currentRevision(),
      vertexKey: binding.row.nodeKey || binding.row.key || null, vertexIndex: binding.row.index,
      screenPoint: p, pointerType: 'touch',
    });};
    const enqueue = operation => {
      chain = chain.then(operation).catch(error => { cancelled = true; reportEditingOperationError(error, { type: 'touch-vertex' }); });
    };
    const confirmedChoice = () => getPacket().selectedVertex && choices.find(candidate =>
      (candidate.nodeKey || candidate.key || null) === getPacket().selectedVertex.vertexKey && binding.kind === getPacket().selectedVertex.kind);
    node.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' || pointer !== null) return;
      event.preventDefault(); pointer = event.pointerId; start = point(event); moving = false; cancelled = false;
      epoch = editing.inputRevision(); gesture = 'touch-vertex-' + (++editingGestureSequence); node.setPointerCapture(pointer);
      choices = binding.rows.filter(candidate => {
        const p = frameProjectCoordinate(candidate.coordinate || candidate.coord, binding.frame);
        return p && Math.hypot(p[0] - start[0], p[1] - start[1]) <= 22;
      });
      const confirmed = confirmedChoice();
      if (confirmed) binding.row = confirmed;
      if (choices.length <= 1 || confirmed) enqueue(() => dispatch('select', start));
    });
    node.addEventListener('pointermove', event => {
      if (event.pointerId !== pointer) return;
      event.preventDefault();
      if (epoch !== editing.inputRevision()) { cancelled = true; return; }
      if (cancelled) return;
      const p = point(event);
      if (!moving && Math.hypot(p[0] - start[0], p[1] - start[1]) < 8) return;
      if (choices.length > 1 && !confirmedChoice()) return;
      if (!moving) { moving = true; enqueue(() => dispatch('drag-start', start)); }
      enqueue(() => dispatch('drag-move', p));
    });
    node.addEventListener('pointerup', event => {
      if (event.pointerId !== pointer) return;
      event.preventDefault(); const p = point(event); pointer = null; cancelled ||= epoch !== editing.inputRevision();
      if (cancelled) { enqueue(() => publishEditingInteraction({ type: 'gesture-cancel' })); return; }
      if (moving) { enqueue(() => dispatch('drag-end', p)); return; }
      if (choices.length > 1) {
        const generation = getPacket().projectGeneration;
        editing.openVertexChooser(choices, p, chosen => publishEditingInteraction({
          type: binding.kind + '-select', projectGeneration: generation, targetRef: binding.targetRef,
          vertexKey: chosen.nodeKey || chosen.key || null, vertexIndex: chosen.index, pointerType: 'touch',
        }));
      }
    });
    node.addEventListener('pointercancel', () => { pointer = null; cancelled = true; enqueue(() => publishEditingInteraction({ type: 'gesture-cancel' })); });
    node.addEventListener('click', event => { if (event.pointerType === 'touch') { event.preventDefault(); event.stopPropagation(); } }, true);
  };
  const editingDragBehavior = (kind, targetRef = null) => {
    let gestureId = '';
    return interaction.d3?.behavior?.drag?.()
      .on('dragstart', function(item) {
        gestureId = `editing-${++editingGestureSequence}`;
        const sourceEvent = interaction.d3?.event?.sourceEvent;
        sourceEvent?.preventDefault?.();
        sourceEvent?.stopPropagation?.();
        publishEditingInteraction({
          type: `${kind}-drag-start`, gestureId, targetRef: targetRef || item?.targetRef,
          vertexKey: item?.nodeKey || item?.key || null, vertexIndex: item?.index,
          screenPoint: localEditingPoint(), ...pointerMetadata(sourceEvent),
        });
      })
      .on('drag', function(item) {
        const sourceEvent = interaction.d3?.event?.sourceEvent;
        publishEditingInteraction({
          type: `${kind}-drag-move`, gestureId, targetRef: targetRef || item?.targetRef,
          vertexKey: item?.nodeKey || item?.key || null, vertexIndex: item?.index,
          screenPoint: localEditingPoint(), ...pointerMetadata(sourceEvent),
        });
      })
      .on('dragend', function(item) {
        const sourceEvent = interaction.d3?.event?.sourceEvent;
        sourceEvent?.preventDefault?.();
        sourceEvent?.stopPropagation?.();
        publishEditingInteraction({
          type: `${kind}-drag-end`, gestureId, targetRef: targetRef || item?.targetRef,
          vertexKey: item?.nodeKey || item?.key || null, vertexIndex: item?.index,
          screenPoint: localEditingPoint(), ...pointerMetadata(sourceEvent),
        });
        gestureId = '';
      });
  };
  const geometryPreviewIssueClass = (kind = '') => {
    if (kind === 'overlap') return 'issue-overlap';
    if (kind === 'gap' || kind === 'shared-boundary-gap') return 'issue-gap';
    if (['invalid-sovereign', 'orphan-administrative', 'outside-parent', 'missing-territorial-reference', 'duplicate-id'].includes(kind)) return 'issue-relation';
    return 'issue-invalid';
  };

  const renderBoundaryEdit = (frameContext = null, packet = getPacket()) => {
    active();
    const boundary = packet?.boundaryEdit;
    const view = frameContext?.viewRevision;
    const projection = frameContext?.projectionRevision;
    if (!editingChannelChanged('boundary', editing.boundaryEditLayer, boundary, view, projection, JSON.stringify(editing.getInteractionStyle?.()))) return true;
    const visibleSegments = queryBoundaryDisplay(boundary?.displayIndex?.segments, boundaryViewBounds(frameContext), boundary?.segments || []);
    const data = (boundary?.draft || editing.getInteractionStyle?.()?.selection?.outlineVisible === false ? ['coast', 'shared'] : []).map(kind => {
      const segments = visibleSegments.filter(segment => (segment.kind === 'coast' ? 'coast' : 'shared') === kind);
      return segments.length ? {
        key: `${boundary?.preparationId || 0}:${boundary?.draft ? packet.revision : 0}:${kind}:${view ?? 0}:${projection ?? 0}`,
        kind,
        style: resolveMapStrokeStyle(editing.getInteractionStyle?.() || resolveMapInteractionStyle(), 'edit-target', { directManipulation: true, boundaryKind: kind }),
        geometry: { type: 'MultiLineString', coordinates: segments.map(segment => [segment.start, segment.end]) },
      } : null;
    }).filter(Boolean);
    const layer = editing.boundaryEditLayer;
    if (!layer) return false;
    const selection = layer.selectAll('path.boundary-edit-segment').data(data, d => d.key);
    selection.enter().append('path').attr('class', 'boundary-edit-segment');
    selection.exit().remove();
    layer.selectAll('path.boundary-edit-segment')
      .attr('d', d => framePath(frameContext)?.({ type: 'Feature', geometry: d.geometry, properties: {} }))
      .attr('data-gpu-scene-key', d => `boundary-edit:${d.key}`)
      .attr('stroke', d => d.style.color)
      .attr('stroke-width', d => scaleInteractionStroke(d.style, frameContext).width)
      .attr('stroke-opacity', d => d.style.alpha)
      .attr('stroke-dasharray', d => d.style.dash.join(' '))
      .attr('stroke-linecap', d => d.style.cap).attr('stroke-linejoin', d => d.style.join)
      .classed('coast', d => d.kind === 'coast')
      .classed('shared', d => d.kind === 'shared')
      .on('click.vertex-add', null);
    editing.replaceGpuSceneDomain?.('boundary-edit', {
      strokes: data.map(item => ({
        key: `boundary-edit:${item.key}`,
        geometryRevision: item.key,
        geometry: item.geometry,
        order: 9800,
        style: item.style,
      })),
    });
    return true;
  };
  const vertexRows = new WeakMap();
  const vertexByKey = new WeakMap();
  let vertexProjectionCache = null;
  let visibleVertexRows = [];
  const thinVisibleCoastHandles = (handles, points, activeKey) => {
    const zoom = editing.currentMapZoom?.() || 1;
    const mobile = editing.isMobile?.() === true;
    const minDistance = Math.max(mobile ? 7 : 4, (mobile ? 18 : 11) / Math.sqrt(Math.max(1, zoom)));
    const occupied = new Map();
    const accepted = [];
    for (const handle of handles) {
      const point = points.get(handle);
      if (!point) continue;
      const gx = Math.floor(point[0] / minDistance), gy = Math.floor(point[1] / minDistance);
      let crowded = false;
      for (let x = gx - 1; x <= gx + 1 && !crowded; x += 1) {
        for (let y = gy - 1; y <= gy + 1; y += 1) {
          const other = occupied.get(`${x}:${y}`);
          if (other && Math.hypot(point[0] - other[0], point[1] - other[1]) < minDistance) { crowded = true; break; }
        }
      }
      if (crowded && !handle.fixed && handle.nodeKey !== activeKey) continue;
      occupied.set(`${gx}:${gy}`, point);
      accepted.push(handle);
    }
    return accepted;
  };
  const renderVertices = (frameContext = null, packet = getPacket()) => {
    active();
    const boundaryHandles = packet?.boundaryEdit?.handles || [];
    const boundaryMode = ['territorial-border', 'country-coast'].includes(packet?.tool) && boundaryHandles.length > 0;
    let objectPacket = boundaryMode ? {
      mode: packet.tool,
      handles: boundaryHandles,
      targetRef: {
        domain: 'territorial',
        type: 'entity',
        id: String(boundaryHandles[0]?.ownerIds?.[0] || ''),
      },
    } : packet?.objectVertices;
    if (objectPacket?.targetRef && selection.objectRefVisible?.(objectPacket.targetRef) === false) objectPacket = null;
    const handles = objectPacket?.handles;
    let rows = handles && vertexRows.get(handles);
    if (!rows) {
      rows = boundaryMode && packet.boundaryEdit.displayIndex ? handles : (handles || []).map(item => ({ ...item, coord: item.coordinate }));
      if (handles) {
        vertexRows.set(handles, rows);
        if (!packet?.boundaryEdit?.displayIndex) vertexByKey.set(handles, new Map(rows.map(row => [row.nodeKey, row])));
      }
    }
    const activeKey = packet?.boundaryActiveNodeKey;
    const activeCoordinate = packet?.boundaryActiveCoordinate;
    const cache = vertexProjectionCache;
    const sameProjection = frameContext && cache && cache.handles === handles && cache.view === frameContext.viewRevision
      && cache.projection === frameContext.projectionRevision && cache.activeKey === activeKey;
    let points, data;
    if (sameProjection) {
      ({ points, data } = cache);
      if (activeKey && (cache.activeCoordinate?.[0] !== activeCoordinate?.[0] || cache.activeCoordinate?.[1] !== activeCoordinate?.[1])) {
        const active = packet?.boundaryEdit?.displayIndex
          ? rows[packet.boundaryEdit.displayIndex.nodeKeys?.[activeKey]] : vertexByKey.get(handles)?.get(activeKey);
        if (active) points.set(active, frameProjectCoordinate(activeCoordinate || active.coord, frameContext));
        cache.activeCoordinate = activeCoordinate;
      }
    }
    else {
      let candidates = boundaryMode
        ? queryBoundaryDisplay(packet.boundaryEdit.displayIndex?.handles, boundaryViewBounds(frameContext), rows) : rows;
      const active = activeKey && (packet?.boundaryEdit?.displayIndex
        ? rows[packet.boundaryEdit.displayIndex.nodeKeys?.[activeKey]] : vertexByKey.get(handles)?.get(activeKey));
      if (active && !candidates.includes(active)) candidates = [...candidates, active];
      candidates = candidates.slice().sort((a, b) => Number(b.nodeKey === activeKey) - Number(a.nodeKey === activeKey) || Number(!!b.fixed) - Number(!!a.fixed));
      points = new Map(candidates.map(row => [row, frameProjectCoordinate(row === active && activeCoordinate ? activeCoordinate : row.coord, frameContext)]));
      data = boundaryMode ? thinVisibleCoastHandles(candidates, points, activeKey) : candidates.filter(row => points.get(row));
      vertexProjectionCache = { handles, view: frameContext?.viewRevision, projection: frameContext?.projectionRevision, activeKey, activeCoordinate, points, data };
    }
    const layer = editing.vertexLayer;
    if (!layer) return false;
    // Selection outlines may be disabled while vertex editing remains active.
    // In that policy the existing editing layer owns the committed hydro line.
    const editFeature = objectPacket?.targetRef?.domain === 'hydro'
      && editing.getInteractionStyle?.()?.selection?.outlineVisible === false
      ? selection.mapFeatureForObjectRef(objectPacket.targetRef) : null;
    const editOutline = layer.selectAll('path.object-edit-outline').data(editFeature?.geometry ? [editFeature] : [], feature => String(feature.id));
    editOutline.enter().append('path').attr('class', 'object-edit-outline');
    editOutline.exit().remove();
    const editStyle = scaleInteractionStroke(resolveMapStrokeStyle(editing.getInteractionStyle?.() || resolveMapInteractionStyle(),
      'edit-target', { directManipulation: true }), frameContext);
    layer.selectAll('path.object-edit-outline').attr('fill', 'none').attr('pointer-events', 'none')
      .attr('data-object-key', objectPacket?.targetRef?.key || '')
      .attr('d', framePath(frameContext))
      .attr('stroke', editStyle.color).attr('stroke-width', editStyle.width).attr('stroke-opacity', editStyle.alpha);
    const handlesChanged = editingChannelChanged('vertices', layer, packet?.objectVertices, packet?.boundaryEdit, packet?.tool);
    const joinChanged = handlesChanged || data.length !== visibleVertexRows.length || data.some((row, i) => row !== visibleVertexRows[i]);
    let enteredVertices = layer.selectAll('circle.vertex-handle').filter(() => false);
    if (joinChanged) {
      const selection = layer.selectAll('circle.vertex-handle').data(data, d => d.nodeKey || d.key || d.index);
      enteredVertices = selection.enter().append('circle').attr('class', 'vertex-handle draft-interactive');
      selection.exit().remove(); visibleVertexRows = data;
    }
    const allVertices = layer.selectAll('circle.vertex-handle');
    allVertices
      .attr('r', editing.isMobile?.()?22:(boundaryMode?5.2:4.5))
      .classed('touch-vertex-handle',!!editing.isMobile?.())
      .classed('country-vertex', boundaryMode)
      .classed('coast-vertex', d => boundaryMode && d.boundaryKind === 'coast')
      .classed('shared-boundary-vertex', d => boundaryMode && d.boundaryKind === 'shared')
      .classed('fixed-boundary-vertex', d => boundaryMode && d.fixed)
      .attr('transform', d => {
        const point = points.get(d);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    const dotJoin=layer.selectAll('circle.vertex-visible-dot').data(editing.isMobile?.()?data:[],d=>d.nodeKey||d.key||d.index);dotJoin.exit().remove();dotJoin.enter().append('circle').attr('class','vertex-visible-dot').attr('pointer-events','none');
    layer.selectAll('circle.vertex-visible-dot').attr('r',d=>(d.nodeKey||d.key)===packet.selectedVertex?.vertexKey?7:5).attr('fill',d=>d.fixed?'#7b8b9c':'#b9dfff').attr('stroke','#17314b').attr('stroke-width',1.5).attr('transform',d=>{const p=points.get(d);return p?'translate('+p[0]+','+p[1]+')':'translate(-9999,-9999)';});
    const eventVertices = handlesChanged ? allVertices : enteredVertices;
    eventVertices.on('.drag', null);
    const dragKind = boundaryMode ? 'boundary-vertex' : 'object-vertex';
    if (objectPacket?.targetRef) {
      const behavior = editingDragBehavior(dragKind, objectPacket.targetRef);
      if (behavior) {
        if (boundaryMode) eventVertices.filter(d => !d.fixed).call(behavior);
        else eventVertices.call(behavior);
      }
    }
    eventVertices.on('click.vertex-select',function(d){const source=editing.d3.event;if(source?.pointerType==='touch')return;source?.stopPropagation();publishEditingInteraction({type:dragKind+'-select',targetRef:objectPacket?.targetRef,vertexKey:d.nodeKey||d.key||null,vertexIndex:d.index});});
    if(editing.isMobile?.()){allVertices.on('touchstart.drag',null);allVertices.each(function(d){bindTouchVertex(this,dragKind,d,objectPacket?.targetRef,rows,frameContext);});}
    allVertices.classed('selected',d=>(d.nodeKey||d.key)===packet.selectedVertex?.vertexKey);
    eventVertices.each(function(d) {
      let title = editing.d3?.select(this).select('title');
      if (title?.empty?.()) title = editing.d3.select(this).append('title');
      title?.text?.(boundaryMode
        ? (d.fixed ? '선택 밖 국가와 연결되어 고정된 접경점' : d.boundaryKind === 'shared' ? `${d.ownerIds?.length || 2}개 국가가 공유하는 국경 꼭짓점` : '해안선 꼭짓점')
        : '꼭짓점');
    });
    return true;
  };

  const renderDraftInsertionHandle = (frameContext = null, packet = getPacket()) => {
    active();
    const layer = interaction.draftLayer;
    if (!layer) return false;
    const target = packet?.draft?.insertTarget;
    const data = target?.coordinate
      && packet?.draft?.active
      && !packet?.draft?.dragging ? [target] : [];
    const selection = layer.selectAll('g.draft-insert-handle').data(data, item => item.segmentIndex);
    const enter = selection.enter().append('g').attr('class', 'draft-insert-handle draft-interactive');
    const mobile = interaction.isMobile?.() === true;
    enter.append('circle').attr('class', 'draft-insert-hit').attr('r', mobile ? 18 : 13);
    enter.append('circle').attr('class', 'draft-insert-dot').attr('r', mobile ? 9 : 7);
    enter.append('path').attr('class', 'draft-insert-plus').attr('d', 'M-3.5 0h7M0-3.5v7');
    selection.exit().remove();
    layer.selectAll('g.draft-insert-handle')
      .attr('transform', item => {
        const point = frameProjectCoordinate(item.coordinate, frameContext);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      })
      .on('click', function() {
        interaction.d3?.event?.preventDefault?.();
        interaction.d3?.event?.stopPropagation?.();
        publishEditingInteraction({ type: 'draft-insert-request' });
      })
      .on('mouseleave', d => {
        const relatedTarget = interaction.d3.event.relatedTarget;
        if (relatedTarget?.closest?.('path.draft-segment-hit')?.parentNode === layer.node()) return;
        publishEditingInteraction({ type: 'draft-segment-leave', segmentIndex: d.segmentIndex });
      });
    return true;
  };
  const renderGeometryPreview = (frameContext = null, packet = getPacket()) => {
    active();
    const layer = interaction.previewLayer;
    if (!layer) return false;
    if (!editingChannelChanged('preview', layer, packet?.preview, selection.resolvedInteractionStyle?.())) return reprojectEditingLayer(layer, frameContext);
    const session = packet?.preview?.session || packet?.preview;
    const delta = session && !['discarded', 'committed'].includes(session.status) ? session.delta || {} : {};
    const rows = [];
    const path = framePath(frameContext);
    for (const [className, geometry] of [
      ['geometry-preview-remove', delta.removedGeometry],
      ['geometry-preview-add', delta.addedGeometry],
    ]) {
      if (!geometry) continue;
      const feature = interaction.featureFromGeometry?.(geometry);
      if (interaction.hasAreaGeometry?.(feature)) {
        rows.push({ geometry: feature.geometry, className: `${className} geometry-preview-fill` });
      }
      const outline = interaction.buildRenderableStrokeFeature?.(feature);
      if (outline?.geometry?.coordinates?.length) {
        rows.push({ geometry: outline.geometry, className: `${className} geometry-preview-outline` });
      }
    }
    for (const geometry of delta.oldBoundaries || []) {
      const outline = interaction.buildRenderableStrokeFeature?.(interaction.featureFromGeometry?.(geometry));
      if (outline) rows.push({ geometry: outline.geometry, className: 'geometry-preview-old-boundary' });
    }
    for (const geometry of delta.newBoundaries || []) {
      const outline = interaction.buildRenderableStrokeFeature?.(interaction.featureFromGeometry?.(geometry));
      if (outline) rows.push({ geometry: outline.geometry, className: 'geometry-preview-new-boundary' });
    }
    rows.forEach((row, index) => { row.key = `${session.sessionId}:${row.className}:${index}`; });
    joinEditingNodes(layer, 'path.editing-preview-path', rows, d => d.key)
      .attr('class', d => `editing-preview-path ${d.className}`)
      .attr('d', d => path({ type: 'Feature', geometry: d.geometry, properties: {} }));
    interaction.syncGpuInteractionLayer?.('preview', layer);
    return true;
  };

  const renderValidation = (frameContext = null, packet = getPacket()) => {
    active();
    const layer = interaction.validationLayer;
    if (!layer) return false;
    const audit = interaction.getValidationPacket?.() || {};
    if (!editingChannelChanged('validation', layer, packet?.validationIssues, audit.issues, audit.selectedIssueId)) return reprojectEditingLayer(layer, frameContext);
    const rows = [];
    const markers = [];
    const path = framePath(frameContext);
    const issues = packet?.validationIssues?.length ? packet.validationIssues : audit.issues || [];
    for (const issue of issues) {
      const className = geometryPreviewIssueClass(issue.kind);
      if (issue.geometry) {
        const feature = interaction.featureFromGeometry?.(issue.geometry);
        const selectedClass = audit.selectedIssueId === issue.id ? ' selected' : '';
        if (interaction.hasAreaGeometry?.(feature)) {
          rows.push({ key: `${issue.id}:fill:${rows.length}`, geometry: feature.geometry, className: `map-validation-issue map-validation-fill ${className}${selectedClass}` });
        }
        const outline = interaction.buildRenderableStrokeFeature?.(feature);
        if (outline?.geometry?.coordinates?.length) {
          rows.push({ key: `${issue.id}:outline:${rows.length}`, geometry: outline.geometry, className: `map-validation-issue map-validation-outline ${className}${selectedClass}` });
        }
      }
      const coordinate = interaction.issueCoordinate?.(issue);
      if (coordinate) markers.push({ key: issue.id || markers.length, coordinate, className, radius: audit.selectedIssueId === issue.id ? 8 : 6, message: issue.message });
    }
    joinEditingNodes(layer, 'path.editing-validation-path', rows, d => d.key).attr('class', d => `editing-validation-path ${d.className}`)
      .attr('d', d => path({ type: 'Feature', properties: {}, geometry: d.geometry }));
    joinEditingNodes(layer, 'circle.map-validation-marker', markers, d => d.key).attr('class', d => `map-validation-marker ${d.className}`).attr('r', d => d.radius)
      .each(function(d) { const node = interaction.d3.select(this); if (node.select('title').empty()) node.append('title'); node.select('title').text(d.message || '지도 오류'); });
    return reprojectEditingLayer(layer, frameContext);
  };
  const renderMagnifier = (frame, packet) => {
    const root = editing.vertexLayer;
    if (!root) return;
    const value = packet.magnifier;
    const join = root.selectAll('svg.editing-magnifier').data(value ? [value] : []);
    join.exit().remove();
    const enter = join.enter().append('svg').attr('class', 'editing-magnifier').attr('width', 116).attr('height', 116)
      .attr('viewBox', '-29 -29 58 58').attr('pointer-events', 'none');
    enter.append('rect').attr('x', -29).attr('y', -29).attr('width', 58).attr('height', 58).attr('rx', 8)
      .attr('fill', '#142437').attr('stroke', '#d9eaff').attr('stroke-width', 1);
    const all = root.selectAll('svg.editing-magnifier');
    if (!value) return;
    all.attr('x', Math.max(6, value.screenPoint[0] - 58)).attr('y', Math.max(6, value.screenPoint[1] - 154));
    const center = frameProjectCoordinate(value.coordinate, frame);
    if (!center) return;
    const segments = packet.boundaryEdit?.segments || packet.objectVertices?.previewSegments || packet.draft?.segments || [];
    const data = segments.map(row => ({ a: frameProjectCoordinate(row.start, frame), b: frameProjectCoordinate(row.end, frame) }))
      .filter(row => row.a && row.b && Math.min(Math.hypot(row.a[0] - center[0], row.a[1] - center[1]), Math.hypot(row.b[0] - center[0], row.b[1] - center[1])) < 80);
    const lines = all.selectAll('line').data(data); lines.enter().append('line'); lines.exit().remove();
    all.selectAll('line').attr('x1', d => d.a[0] - center[0]).attr('y1', d => d.a[1] - center[1])
      .attr('x2', d => d.b[0] - center[0]).attr('y2', d => d.b[1] - center[1]).attr('stroke', '#8fd3ff').attr('stroke-width', 1);
    const dot = all.selectAll('circle').data([value]); dot.enter().append('circle');
    all.selectAll('circle').attr('r', 2.5).attr('fill', packet.snap ? '#80f0ba' : '#ffffff').attr('stroke', '#152638').attr('stroke-width', 1);
  };
  const renderSnap = (frameContext = null, packet = getPacket()) => {
    renderMagnifier(frameContext, packet);
    active();
    const layer = interaction.snapLayer;
    if (!layer) return false;
    const indicator = packet?.snap;
    if (editingChannelChanged('snap', layer, indicator)) {
      joinEditingNodes(layer, 'path.snap-indicator-segment', indicator?.segmentEndpoints?.length === 2 ? [{ geometry: { type: 'LineString', coordinates: indicator.segmentEndpoints } }] : [], () => 'segment');
      joinEditingNodes(layer, 'path.snap-indicator-cross', indicator?.kind === 'intersection' ? [indicator] : [], () => 'cross');
      joinEditingNodes(layer, 'circle.snap-indicator-point', indicator?.coordinate ? [indicator] : [], () => 'point').attr('r', 6);
    }
    return reprojectEditingLayer(layer, frameContext);
  };

  const renderDraft = (frameContext = null, packet = getPacket()) => {
    active();
    const layer = interaction.draftLayer;
    if (!layer) return false;
    const rawDraft = packet?.draft || EMPTY_EDITING_RENDER_PACKET.draft;
    const draft = rawDraft.active ? rawDraft : EMPTY_EDITING_RENDER_PACKET.draft;
    const operation = packet?.territoryOperation;
    if (!editingChannelChanged('draft', layer, draft, operation, packet.tool, selection.resolvedInteractionStyle?.())) return reprojectEditingLayer(layer, frameContext);
    const path = framePath(frameContext);
    const { d3, isMobile, formatTerritoryArea } = interaction;
    const stop = () => { d3?.event?.preventDefault?.(); d3?.event?.stopPropagation?.(); };
    const components = (operation?.components || []).map(item => ({ ...item, geometry: item.geometry }));
    const componentPaths = joinEditingNodes(layer, 'path.territory-component', components, d => d.key)
      .attr('class', d => `territory-component${d.usesRiverBoundary ? ' river-partition' : ''} ${d.selected ? 'selected-component' : 'available'}${d.hovered && !d.selected ? ' hovered-component' : ''}`)
      .on('mouseenter', d => publishEditingInteraction({ type: 'territory-component-hover', componentKey: d.key }))
      .on('mouseleave', d => publishEditingInteraction({ type: 'territory-component-leave', componentKey: d.key }))
      .on('click', d => { stop(); publishEditingInteraction({ type: 'territory-component-toggle', componentKey: d.key, screenPoint: localEditingPoint() }); });
    componentPaths.each(function(d) { const node = d3.select(this); if (node.select('title').empty()) node.append('title'); node.select('title').text(`${d.countryName} · ${formatTerritoryArea?.(d.areaKm2) || d.areaKm2}`); });
    joinEditingNodes(layer, 'path.territory-candidate', operation?.candidates || [], d => d.key)
      .attr('class', d => `territory-candidate ${d.selected ? 'selected-candidate' : 'alternate-candidate'}`)
      .attr('aria-label', d => d.interactive === false ? '선택 영역' : `조각 ${d.index + 1} · ${d.selected ? '선택됨' : '선택 안 됨'}`)
      .style('pointer-events', d => d.interactive === false ? 'none' : null)
      .on('click', d => { if (d.interactive === false) return; stop(); publishEditingInteraction({ type: 'territory-candidate-select', candidateId: d.id }); });
    const shapes = [
      { key: 'raw', geometry: draft.rawStrokeGeometry, className: 'draft-shape draft-raw-stroke' },
      { key: 'shape', geometry: draft.geometry, className: ['draft-shape', packet.tool === 'annex-territory' ? 'annex-draft' : '', draft.cutStatus ? 'cut-' + draft.cutStatus : draft.issues.length ? 'draft-invalid' : ''].filter(Boolean).join(' ') },
      { key: 'close', geometry: draft.autoCloseSegment ? { type: 'LineString', coordinates: [draft.autoCloseSegment.start, draft.autoCloseSegment.end] } : null, className: 'draft-auto-close-preview' },
    ].filter(d => d.geometry);
    joinEditingNodes(layer, 'path.draft-packet-shape', shapes, d => d.key).attr('class', d => 'draft-packet-shape ' + d.className);
    joinEditingNodes(layer, 'path.draft-split-preview', draft.splitCandidates, d => d.key).attr('class', (_, i) => 'draft-split-preview side-' + (i === 0 ? 'a' : 'b'));
    joinEditingNodes(layer, 'path.draft-segment-hit', draft.segments, d => d.segmentIndex)
      .attr('class', 'draft-segment-hit draft-interactive')
      .on('mousemove', d => { if (!isMobile?.() && !getPacket().draft.dragging) publishEditingInteraction({ type: 'draft-segment-hover', segmentIndex: d.segmentIndex, screenPoint: localEditingPoint() }); })
      .on('mouseleave', d => {
        const relatedTarget = d3.event.relatedTarget;
        if (relatedTarget?.closest?.('g.draft-insert-handle')?.parentNode === layer.node()) return;
        publishEditingInteraction({ type: 'draft-segment-leave', segmentIndex: d.segmentIndex });
      })
      .on('click', d => { stop(); publishEditingInteraction({ type: getPacket().draft.vertexInsertMode ? 'draft-segment-insert' : 'draft-segment-hover', segmentIndex: d.segmentIndex, screenPoint: localEditingPoint() }); });
    const vertices = joinEditingNodes(layer, 'g.draft-vertex', draft.vertices, d => d.index)
      .attr('class', d => 'draft-vertex draft-interactive' + (d.selected ? ' selected' : ''))
      .on('click', d => { stop(); publishEditingInteraction({ type: 'draft-vertex-select', vertexIndex: d.index }); });
    vertices.each(function() {
      // Reused vertices must stay above newly appended segment hit paths.
      this.parentNode.appendChild(this);
      const node = d3.select(this);
      if (node.select('circle').empty()) {
        node.append('circle').attr('class', 'draft-vertex-hit').attr('r', isMobile?.() ? 22 : 10);
        node.append('circle').attr('class', 'draft-vertex-dot').attr('r', isMobile?.() ? 6.5 : 4.5);
        node.append('title');
      }
      node.select('title').text(d => '꼭짓점 ' + (d.index + 1) + ' · 드래그하여 이동');
    });
    const drag = editingDragBehavior('draft-vertex');
    if (drag) vertices.call(drag);
    if(isMobile?.()){vertices.on('touchstart.drag',null);vertices.each(function(d){bindTouchVertex(this,'draft-vertex',d,null,draft.vertices,frameContext);});}
    renderDraftInsertionHandle(frameContext, packet);
    const issues = joinEditingNodes(layer, 'g.draft-issue-marker', draft.issues.filter(d => d.coordinate), (d, i) => d.kind + ':' + (d.vertexIndex ?? d.segmentIndex ?? i));
    issues.each(function(d) {
      const node = d3.select(this);
      if (node.select('circle').empty()) { node.append('circle').attr('r', 7); node.append('path').attr('d', 'M-3.2-3.2 3.2 3.2M3.2-3.2-3.2 3.2'); node.append('title'); }
      node.select('title').text(d.message || '수정이 필요한 위치');
    });
    joinEditingNodes(layer, 'circle.draft-snap-point', draft.snapPoints, d => d.endpoint).attr('class', d => 'draft-snap-point ' + d.endpoint).attr('r', 6);
    const riverSections = [];
    for (const component of operation?.components || []) for (const [i, section] of (component.riverBoundarySegments || []).entries()) {
      if (component.usesRiverBoundary && section.length >= 2) riverSections.push({ key: component.key + ':' + i, selected: component.selected, geometry: { type: 'LineString', coordinates: section } });
    }
    joinEditingNodes(layer, 'path.river-partition-emphasis', riverSections, d => d.key)
      .attr('class', d => 'river-partition-emphasis' + (d.selected ? ' selected' : ''))
      .attr('stroke', interaction.selectionStyle?.color).attr('stroke-width', interactionStrokeScale(frameContext) * Number(interaction.selectionStyle?.primaryWidth || 0));
    void path;
    reprojectEditingLayer(layer, frameContext);
    interaction.syncGpuInteractionLayer?.('draft', layer);
    return true;
  };
 return Object.freeze({renderBoundaryEdit,renderVertices,renderDraft,renderSnap,renderValidation,renderGeometryPreview});
}
