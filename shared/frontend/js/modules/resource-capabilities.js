/** Product entrypoints determine support; background preferences never grant it. */
export function resourceCapabilities(productMode,platform=null) {
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Explicit product mode is required.');
  const resources=platform?.resources??null;
  if(platform!==null&&(!resources||typeof resources.builtinHydro!=='boolean'||typeof resources.builtinPlaces!=='boolean'))throw new TypeError('Resource capabilities require explicit platform resource ports.');
  return Object.freeze({terrain:productMode==='viewer',globe:productMode==='viewer',graticule:productMode==='viewer',globeShadow:productMode==='viewer',
    builtinHydro:resources?.builtinHydro??true,
    builtinPlaces:resources?.builtinPlaces??true,
    eagerBuiltinHydro:productMode==='viewer',eagerBuiltinPlaces:productMode==='viewer'});
}
