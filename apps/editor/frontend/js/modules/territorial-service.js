const text=value => String(value ?? '').trim();
const declaredErrors=new Set(['not-found','locked','unsupported-relation-field','unsupported-field','invalid-flag',
  'invalid-temporal','TIMELINE_ACTIVATION','unsupported-parent-type','invalid-parent','invalid-parent-geometry','invalid-source']);
const errorCodes=Object.freeze({ TARGET_NOT_FOUND: 'not-found',OBJECT_LOCKED: 'locked' });

/** Current Web result adaptation; C++ owns every candidate, validation and commit. */
export function createTerritorialApplicationService({ entityRepository,commandOwner,createId }) {
  if (typeof createId!=='function' || typeof entityRepository?.get!=='function' || typeof commandOwner?.executeCommand!=='function')
    throw new TypeError('The read-only territorial repository, C++ command owner and platform ID allocator are required.');
  const find=(rows,id) => rows.find(row => row.id===id) || null;
  const locked=id => entityRepository.get(text(id))?.properties.locked===true;
  function rejected(reply,id) {
    const code=errorCodes[reply.error.code] || reply.error.code;
    if (!declaredErrors.has(code)) throw Object.assign(new Error(reply.error.message),{ code: reply.error.code });
    const unit=find(reply.beforeTerritorial,id),result={ ok: false,code };
    if (unit && code!=='invalid-source') result.unit=unit;
    if (['invalid-temporal','TIMELINE_ACTIVATION','invalid-parent','invalid-parent-geometry'].includes(code)) result.issues=[reply.error.message];
    return result;
  }
  async function execute(commandId,ids,payload) {
    return commandOwner.executeCommand({ commandId,targets: ids.map(id => ({ domain: 'territorial',id })),payload });
  }
  async function updateMetadata(id,field,value) {
    const key=text(id),reply=await execute('territorial.metadata',[key],{ id: key,field,valuePresent: value!==undefined,
      ...(value===undefined ? {} : { value }) });
    return reply.ok ? { ok: true,changed: reply.changed,unit: find(reply.afterTerritorial,key) } : rejected(reply,key);
  }
  async function setLocked(id,value) {
    const key=text(id),reply=await execute('territorial.lock',[key],{ ids: [key],locked: !!value });
    return reply.ok ? { ok: true,changed: reply.changed,unit: find(reply.afterTerritorial,key) } : rejected(reply,key);
  }
  async function batch(commandId,items,properties) {
    const requested=(items || []).map(item => ({ type: text(item?.type),id: text(item?.id) })).filter(item => item.type && item.id);
    const ids=requested.map(item => item.id),reply=await execute(commandId,ids,{ ids,...properties });
    if (!reply.ok) {
      const failure=rejected(reply,ids[0]);
      if (failure.code==='not-found') {
        const missing=requested.find(item => !find(reply.beforeTerritorial,item.id));
        return { ok: false,code: failure.code,id: missing.id,type: missing.type };
      }
      return failure;
    }
    return { ok: true,changed: reply.changed,units: ids.map(id => find(reply.afterTerritorial,id)).filter(Boolean) };
  }
  async function copyIndependentRegion(sourceId,{ name = '',color = '' } = {}) {
    const id=createId(),key=text(sourceId),reply=await execute('territorial.copy-region',[key,id],{ sourceId: key,id,name,color });
    return reply.ok ? { ok: true,changed: reply.changed,unit: find(reply.afterTerritorial,id) } : rejected(reply,key);
  }
  async function changeAdministrativeParent(id,parentId,{ validateCandidate = null } = {}) {
    const key=text(id),payload={ id: key,parentId: text(parentId) };
    if (!validateCandidate) {
      const reply=await execute('territorial.parent',[key],payload);
      return reply.ok ? { ok: true,changed: reply.changed,unit: find(reply.afterTerritorial,key) } : rejected(reply,key);
    }
    const prepared=await commandOwner.prepareCommand({ commandId: 'territorial.parent',targets: [{ domain: 'territorial',id: key }],payload });
    if (!prepared.ok) return rejected(prepared,key);
    if (!prepared.changed) return { ok: true,changed: false,unit: find(prepared.beforeTerritorial,key) };
    let validation,validationError;
    try {
      validation=await validateCandidate({ feature: find(prepared.beforeTerritorial,key),previousUnits: prepared.beforeTerritorial,
        candidateUnits: prepared.preview.territorialViews,parentId: payload.parentId });
    } catch (error) { validationError=error; }
    if (validationError || validation===false || validation?.ok===false) {
      await commandOwner.cancelCandidate(prepared.candidateId);
      return { ok: false,code: 'invalid-parent-geometry',issues: validationError ? [String(validationError.message || validationError)]
        : validation?.issues || [validation?.message || '상위 단위 변경 조건을 만족하지 않습니다.'],unit: find(prepared.beforeTerritorial,key) };
    }
    const reply=await commandOwner.confirmCandidate(prepared.candidateId,prepared.state.epoch);
    return reply.ok ? { ok: true,changed: reply.changed,unit: find(reply.afterTerritorial,key) } : rejected(reply,key);
  }
  function canDelete(id) {
    const key=text(id),unit=entityRepository.get(key);
    if (!unit) return { ok: false,code: 'not-found' };
    if (unit.properties.locked) return { ok: false,code: 'locked',unit };
    const children=entityRepository.children(key);
    return children.length ? { ok: false,code: 'has-children',unit,children } : { ok: true,unit,children: [] };
  }
  return Object.freeze({ updateMetadata,setLocked,setLockedBatch: (items,value) => batch('territorial.lock',items,{ locked: !!value }),
    setColorBatch: (items,color) => batch('territorial.color',items,{ color: color || null }),copyIndependentRegion,
    changeAdministrativeParent,canDelete,isLocked: locked });
}
