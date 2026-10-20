/** Product entrypoints determine support; background preferences never grant it. */
export function resourceCapabilities(productMode,platform={}) {
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Explicit product mode is required.');
  return Object.freeze({terrain:productMode==='viewer',globe:productMode==='viewer',graticule:productMode==='viewer',globeShadow:productMode==='viewer',
    builtinHydro:platform.builtinHydroAvailable!==false,
    builtinPlaces:platform.builtinPlacesAvailable!==false,
    eagerBuiltinHydro:productMode==='viewer',eagerBuiltinPlaces:productMode==='viewer'});
}
