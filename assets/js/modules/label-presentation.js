import { renderLabelText } from './label-text-presentation.js';
import { isBuiltinPlaceId } from './place-contract.js';

export function createLabelPresentation({ labels,selectionDomain,reportDiagnostic,projectLabelCoordinate,active,stats }) {
  let territorialLabelPositionBindings=[],userLabelPositionBindings=[];
  const labelState=()=>labels.getState();
  const renderTerritorialLabels = (layout, frameContext) => {
    active();
    const layer = labels.territorialLabelLayer;
    if (!layer) return false;
    const state = labelState();
    const resolvedLayout = layout;
    const namesVisible = feature => resolvedLayout?.territorialLabelNames?.get(String(feature.id)) !== false;
    const data = resolvedLayout?.territorialLabels || [];
    const selection = layer.selectAll('g.territorial-label-item').data(data, d => d.id);
    selection.exit().remove();
    // Preserve label identity for selection; the common input owner still dispatches editing tools by ground coordinates.
    const enter = selection.enter().append('g')
      .attr('class', 'territorial-label-item')
      .on('click', function(feature) {
        if (labels.mapClickBlocked?.()) return;
        labels.d3.event.stopPropagation();
        labels.handleMapClick(labels.d3.mouse(labels.svg.node()), { territorialLabelId: String(feature.id) });
      });
    enter.append('image').attr('class', 'territorial-label-flag').attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('aria-hidden', 'true').style('pointer-events', 'none')
      .on('error', function() {
        this.dataset.failedUrl = this.getAttribute('href');
        this.style.display = 'none';
        this.parentNode.querySelector('text')?.setAttribute('x', '0');
      });
    enter.append('text').attr('class', 'country-label').attr('dy', '.35em');
    const all = layer.selectAll('g.territorial-label-item');
    all.attr('data-label-id', feature => String(feature.id || ''));
    all.select('text').text(feature => namesVisible(feature) ? labels.countryName?.(feature) || feature.properties?.name || '' : '')
      .style('display', feature => namesVisible(feature) ? null : 'none')
      .classed('major', d => (resolvedLayout?.territorialLabelScreenAreas?.get(String(d.id || '')) || 0) >= (labels.isMobile?.() ? 3200 : 2200));
    all
      .style('opacity', labels.layerStyle?.(state.layerPresentation, 'objectLabels').opacity)
      .classed('major', d => (resolvedLayout?.territorialLabelScreenAreas?.get(String(d.id || '')) || 0) >= (labels.isMobile?.() ? 3200 : 2200))
      .attr('transform', d => {
        const settings = labels.automaticLabelSettings?.('country', labels.labelSettings(state, 'territorial', labels.getTerritorialLabelRef(d.id).id));
        const anchor = settings?.pinned && settings.manualPosition
          ? settings.manualPosition
          : labels.countryLabelAnchors?.()?.get?.(String(d.id || ''));
        const point = resolvedLayout?.territorialLabelPoints?.get?.(String(d.id || ''))
          || (Array.isArray(anchor) && anchor.length >= 2 ? projectLabelCoordinate(anchor, frameContext) : null);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    territorialLabelPositionBindings = [];
    all.each(function(feature) {
      const nameVisible = namesVisible(feature);
      let flag = resolvedLayout?.territorialFlags?.get(String(feature.id));
      const text = this.querySelector('text');
      const image = this.querySelector('image');
      if (flag?.url === image.dataset.failedUrl) flag = null;
      text.setAttribute('x', flag && nameVisible ? (flag.width + flag.gap) / 2 : 0);
      image.style.display = flag ? '' : 'none';
      if (flag) {
        const width = nameVisible ? text.getComputedTextLength() : 0;
        image.setAttribute('x', nameVisible ? -(width + flag.width + flag.gap) / 2 : -flag.width / 2);
        image.setAttribute('y', -flag.height / 2);
        image.setAttribute('width', flag.width); image.setAttribute('height', flag.height);
        if (image.getAttribute('href') !== flag.url) image.setAttribute('href', flag.url);
      } else image.removeAttribute('href');
      const settings = labels.automaticLabelSettings?.('country', labels.labelSettings(state, 'territorial', labels.getTerritorialLabelRef(feature.id).id));
      const coordinate = settings?.pinned && settings.manualPosition ? settings.manualPosition : labels.countryLabelAnchors?.()?.get?.(String(feature.id || ''));
      territorialLabelPositionBindings.push({ node: this, coordinate: coordinate?.slice() });
    });
    return true;
  };
  const renderUserLabels = (layout, frameContext) => {
    active();
    const layer = labels.labelLayer;
    if (!layer) return false;
    const state = labelState();
    const labelStyle = labels.layerStyle?.(state.layerPresentation, 'labels') || {};
    const selectionState = labels.selectionSnapshot?.() || { primaryKey: null };
    const labelRef = label => labels.normalizeObjectRef({ domain: 'label', type: label.kind || 'label', id: label.id });
    const resolvedLayout = layout;
    const data = state.layerVisibility?.labels ? resolvedLayout.userLabels || [] : [];
    const selection = layer.selectAll('g.user-label').data(data, d => d.id);
    const enter = selection.enter().append('g').attr('class', 'user-label').on('click', function(d) {
      if (labels.mapClickBlocked?.() || state.tool !== 'select' || state.labelPlacementMode) return;
      labels.d3?.event?.stopPropagation?.();
      const point = labels.d3?.mouse?.(labels.svg.node());
      labels.handleObjectSelectionAt?.(point, { sourceEvent: labels.d3?.event, hitRef: { domain: 'label', type: d.kind || 'label', id: d.id } });
    });
    enter.on('mouseenter.hover', async d => {
      try {
        if (!labels.isMobile() && labelState().tool === 'select' && !labelState().mapMoving) {
          const ref = labelRef(d);
          if (!ref) throw new TypeError('An explicit normalized label hover reference is required.');
          await selectionDomain.setHover(ref, { source: 'map' });
        }
      } catch (error) {
        if (!error.cancelled && error.name !== 'AbortError'
          && !['STALE_REVISION','PL-CORE-STALE','PL-CORE-CANCELLED','PL-WORKER-RPC-STALE'].includes(error.code))
          reportDiagnostic({ operation: 'label-hover', stage: 'enter', result: 'failed', code: 'PL-LABEL-HOVER-001', errorCode: error.code || '', message: error.message, error });
      }
    }).on('mouseleave.hover', async d => {
      try {
        const ref = labelRef(d);
        if (!ref) throw new TypeError('An explicit normalized label hover reference is required.');
        await selectionDomain.setHover(null, { source: 'map', expectedKey: ref.key });
      }
      catch (error) {
        if (!error.cancelled && error.name !== 'AbortError'
          && !['STALE_REVISION','PL-CORE-STALE','PL-CORE-CANCELLED','PL-WORKER-RPC-STALE'].includes(error.code))
          reportDiagnostic({ operation: 'label-hover', stage: 'leave', result: 'failed', code: 'PL-LABEL-HOVER-001', errorCode: error.code || '', message: error.message, error });
      }
    });
    enter.append('circle').attr('class', 'user-label-dot').attr('r', 4);
    enter.append('text').attr('class', 'user-label-text').attr('x', 7).attr('dy', '.35em');
    const all = layer.selectAll('g.user-label');
    all.style('opacity', labelStyle.opacity)
      .classed('selected', d => labels.selectionHas?.(labelRef(d)))
      .classed('is-primary-selection', d => labelRef(d)?.key === selectionState.primaryKey)
      .classed('is-secondary-selection', d => labels.selectionHas?.(labelRef(d)) && labelRef(d)?.key !== selectionState.primaryKey)
      .attr('transform', d => {
        const settings = labels.automaticLabelSettings?.(d.kind, labels.labelSettings?.(state, 'label', d.id) || {});
        const coordinate = settings?.pinned && settings.manualPosition ? settings.manualPosition : d.coordinates;
        const point = resolvedLayout?.userLabelPoints?.get?.(String(d.id || ''))
          || projectLabelCoordinate(coordinate, frameContext);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    all.select('text').each(function(label) {
      const rows = resolvedLayout.userLabelRows?.get(String(label.id)) || [{ language: 'ko', text: label.name }];
      renderLabelText(labels.d3.select(this),rows);
    });
    selection.on('.drag', null);
    if (state.tool === 'select' && !state.labelPlacementMode && typeof labels.labelDragBehavior==='function') selection.filter(label => !isBuiltinPlaceId(label.id)).call(labels.labelDragBehavior?.());
    selection.exit().remove();
    userLabelPositionBindings = [];
    layer.selectAll('g.user-label').each(function(label) {
      const settings = labels.automaticLabelSettings?.(label.kind, labels.labelSettings?.(state, 'label', label.id) || {});
      const coordinate = settings?.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
      userLabelPositionBindings.push({ node: this, coordinate: coordinate?.slice() });
    });
    return true;
  };
  const applyCountryLabelPositions = (frameContext = null) => {
    active();
    for (const { node, coordinate: anchor } of territorialLabelPositionBindings) {
      const point = Array.isArray(anchor) && anchor.length >= 2 ? projectLabelCoordinate(anchor, frameContext) : null;
      node?.setAttribute?.('transform', point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)');
    }
    return true;
  };
  const applyUserLabelPositions = (frameContext = null) => {
    active();
    for (const { node, coordinate } of userLabelPositionBindings) {
      const point = projectLabelCoordinate(coordinate, frameContext);
      node?.setAttribute?.('transform', point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)');
    }
    return true;
  };
  const renderTerritorialLabelPositions = frameContext => {
    stats.labelPositionRequestCount += 1;
    const result = applyCountryLabelPositions(frameContext);
    stats.labelPositionCommitCount += 1;
    stats.labelPositionLastFrameRevision = Number(frameContext?.viewRevision || frameContext?.revision || 0);
    return result;
  };
  const renderUserLabelPositions = frameContext => applyUserLabelPositions(frameContext);
  return Object.freeze({renderTerritorialLabels,renderUserLabels,renderTerritorialLabelPositions,renderUserLabelPositions});
}
