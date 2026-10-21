let owner = null;
let actionsOwner = null;

export function registerReferenceImageSurfaceEditing(setter) {
  owner = typeof setter === 'function' ? setter : null;
  return () => {
    if (owner === setter) owner = null;
  };
}

export function setReferenceImageSurfaceEditing(active, text = '') {
  owner?.(active === true, String(text || ''));
}

/** The Surface is the sole presenter; tool controllers only send action state. */
export function registerReferenceImageSurfaceActions(setter) {
  if (typeof setter !== 'function') throw new TypeError('Reference image actions require a Surface presenter.');
  actionsOwner = setter;
  return () => {
    if (actionsOwner === setter) actionsOwner = null;
  };
}

export function setReferenceImageSurfaceActions(tool, projection = null) {
  actionsOwner?.(tool, projection);
}
