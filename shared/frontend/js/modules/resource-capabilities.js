/** Product entrypoints determine support; background preferences never grant it. */
export function resourceCapabilities(productMode,platform=null,{projection=productMode==='viewer'?'globe':'flat'}={}) {
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Explicit product mode is required.');
  const resources=platform?.resources??null;
  if(platform!==null&&(!resources||typeof resources.builtinHydro!=='boolean'||typeof resources.builtinPlaces!=='boolean'))throw new TypeError('Resource capabilities require explicit platform resource ports.');
  if(!['flat','globe'].includes(projection)||(productMode==='editor'&&projection!=='flat'))throw new TypeError('Invalid product projection capability.');
  const globe=projection==='globe';
  return Object.freeze({terrain:globe,globe,graticule:globe,globeShadow:globe,
    builtinHydro:resources?.builtinHydro??true,
    builtinPlaces:resources?.builtinPlaces??true,
    eagerBuiltinHydro:productMode==='viewer',eagerBuiltinPlaces:productMode==='viewer'});
}
