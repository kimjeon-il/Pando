// Existing LSIB exclusions protect disputed or nonstandard source boundaries.

export function classifyLSIBExclusion(properties,disputed){
  if(!properties||typeof properties!=='object'||Array.isArray(properties)||typeof disputed!=='boolean')throw Error('Explicit LSIB properties and dispute flag required');
  if(properties.RANK!=='1'||properties.STATUS!=='International Boundary')return 'special-or-separation-line';
  if(disputed)return 'existing-disputed-territory-or-protected-country-pair';
  const note=Object.hasOwn(properties,'NOTES')?properties.NOTES:'';if(typeof note!=='string')throw Error('LSIB note must be a string');
  const normalized=note.toLowerCase();
  if(['uncertain','condominium','neutral zone','invernada'].some(word=>normalized.includes(word)))return 'uncertain-or-joint-sovereignty';
  if(normalized.includes('island sovereignty'))return 'river-island-sovereignty-needs-independent-review';
  return null;
}
