let owner = null;

export function registerReferenceImageSurfaceEditing(setter) {
  owner = typeof setter === 'function' ? setter : null;
  return () => {
    if (owner === setter) owner = null;
  };
}

export function setReferenceImageSurfaceEditing(active, text = '') {
  owner?.(active === true, String(text || ''));
}
