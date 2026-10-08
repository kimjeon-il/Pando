// Shared by the browser handoff proof and its production-domain RAF regression.
// Keep this evidence bounded: do not copy full successor geometry or SVG paths.
export function boundaryDragCommitEvidence({ target, originalCoordinate, preUpCoordinate, requests, pending }) {
  const request = requests.length === 1 ? requests[0] : null;
  // Mouseup flushes the last RAF-queued drag sample. Only the request submitted
  // after that flush owns the committed target; pre-up coordinates are evidence.
  const editedCoordinate = request?.coordinate?.slice() || null;
  const finite = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  const displacement = finite(editedCoordinate) && finite(originalCoordinate)
    ? Math.hypot(editedCoordinate[0] - originalCoordinate[0], editedCoordinate[1] - originalCoordinate[1]) : null;
  const packetContainsEditedCoordinate = finite(editedCoordinate) && pending.coordinates.some((_, index, values) => index % 2 === 0
    && Math.hypot(values[index] - editedCoordinate[0], values[index + 1] - editedCoordinate[1]) < 0.00002);
  return {
    target, originalCoordinate, preUpCoordinate, editedCoordinate, requestCount: requests.length, request,
    packet: { key: pending.key, revision: pending.packetRevision, previewId: pending.id, status: pending.status },
    requestMatchesTarget: !!request && request.operation === 'boundary-move'
      && !!target.nodeKey && request.nodeKey === target.nodeKey
      && !!target.preparationId && request.preparationId === target.preparationId
      && target.previewId > 0 && request.previewId === target.previewId && pending.id === target.previewId,
    frozenRequestPacket: !!request && request.packetStatus === 'pending-result' && pending.status === 'pending-result'
      && !!pending.packetRevision && request.packetRevision === pending.packetRevision,
    displacement, meaningfulDisplacement: displacement > 0.00002, packetContainsEditedCoordinate,
  };
}
