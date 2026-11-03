import { geometryReferenceFor } from './geometry-version-store.js';
import { geometryRevisionKey } from './geometry-versions.js';

// A verified Worker acknowledgement is the only usable base. A JS geometry
// identity/revision is NOT proof of equivalent coordinates across documents.
// Only the exact same deeply frozen GeometryVersionStore object may omit bytes.
export function createCountryBoundaryGeometryTransport({ onDecision } = {}) {
  let accepted = null;
  let pending = null;

  function reset() {
    accepted = null;
    pending = null;
  }

  function planReplace(features) {
    const order = features.map(feature => String(feature.id));
    const validOrder = order.every(Boolean) && new Set(order).size === order.length;
    const snapshots = features.map(feature => ({
      id: String(feature.id),
      geometry: feature.geometry,
      reference: geometryReferenceFor(feature.geometry),
      revision: geometryRevisionKey(feature.geometry),
    }));
    const full = () => ({
      type: 'replace', transportVersion: 1,
      features: features.map((feature, index) => ({
        ...feature, boundaryGeometryRevision: snapshots[index].revision,
      })),
      removedIds: [],
    });

    let message = full();
    let reusedGeometryCount = 0;
    const acceptedBefore = accepted, pendingBefore = pending;
    let reason = !validOrder ? 'invalid-feature-order'
      : !accepted ? 'no-acknowledged-base'
        : pending ? 'pending-unacknowledged-request' : 'no-certified-geometry-reuse';
    let orderCompatible = null, firstOrderMismatchIndex = -1;
    if (validOrder && accepted && !pending) {
      const nextIds = new Set(order);
      // Existing prepared-store Map order is stable for deletion and append.
      // Insertion or reordering in the middle uses an authoritative full frame.
      const expectedOrder = [
        ...accepted.order.filter(id => nextIds.has(id)),
        ...order.filter(id => !accepted.byId.has(id)),
      ];
      orderCompatible = expectedOrder.length === order.length
        && expectedOrder.every((id, index) => id === order[index]);
      if (!orderCompatible) {
        reason = 'order-incompatible';
        firstOrderMismatchIndex = expectedOrder.findIndex((id, index) => id !== order[index]);
        if (firstOrderMismatchIndex < 0) firstOrderMismatchIndex = Math.min(expectedOrder.length, order.length);
      }
      if (orderCompatible) {
        const deltaFeatures = features.map((feature, index) => {
          const current = snapshots[index], previous = accepted.byId.get(current.id);
          const same = current.reference && previous?.reference
            && current.geometry === previous.geometry
            && current.revision === previous.revision
            && current.reference.id === previous.reference.id
            && current.reference.version === previous.reference.version;
          if (!same) return { ...feature, boundaryGeometryRevision: current.revision };
          reusedGeometryCount += 1;
          const { geometry, ...metadata } = feature;
          return { ...metadata, boundaryGeometryRevision: current.revision };
        });
        if (reusedGeometryCount) {
          message = {
            type: 'delta', transportVersion: 1, baseToken: accepted.token,
            features: deltaFeatures,
            removedIds: accepted.order.filter(id => !nextIds.has(id)),
          };
          reason = 'certified-geometry-reuse';
        }
      }
    }

    // The next message must be full until this request has actually been
    // acknowledged; Worker coalescing may skip any in-flight preparation.
    pending = { order, snapshots, mode: message.type, reusedGeometryCount };
    // Only explicit browser/test diagnostics receive the decision; no IDs,
    // coordinates or full geometry are copied, and production calls remain
    // on the same message protocol.
    if (typeof onDecision === 'function') {
      const incoming = new Set(order);
      const addedIds = order.filter(id => !acceptedBefore?.byId.has(id)).length;
      const removedIds = acceptedBefore?.order.filter(id => !incoming.has(id)).length || 0;
      try {
        onDecision({mode: message.type, reason, acknowledgedBase: !!acceptedBefore,
          pendingMode: pendingBefore?.mode || null, validOrder, orderCompatible,
          firstOrderMismatchIndex, totalIds: order.length, addedIds, removedIds,
          certifiedReuseCount: reusedGeometryCount});
      } catch { /* Diagnostics must never change the map's safety protocol. */ }
    }
    return message;
  }

  function acknowledge(baseToken) {
    if (!pending || typeof baseToken !== 'string' || !baseToken) {
      reset();
      return false;
    }
    accepted = {
      token: baseToken,
      order: pending.order,
      byId: new Map(pending.snapshots.map(snapshot => [snapshot.id, snapshot])),
    };
    pending = null;
    return true;
  }

  return Object.freeze({
    planReplace,
    acknowledge,
    reset,
    pendingMode: () => pending?.mode || null,
    pendingReusedGeometryCount: () => pending?.reusedGeometryCount || 0,
  });
}
