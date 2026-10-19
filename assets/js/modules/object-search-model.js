const TYPE_LABELS = Object.freeze({objects:'객체',distributions:'분포',labels:'지명',genericFeatures:'기타 객체'});
/** The caller supplies current-time, visible objects from the global catalog. */
export function createObjectSearchModel({items,groups,itemRef,compare}) {
  const rows = new Map();
  for (const group of groups) for (const source of items(group)) {
    const layerGroup=source.layerGroup||group,ref=itemRef(layerGroup,source.id),key=ref?.key||layerGroup+':'+source.id;
    if(rows.has(key))continue;
    const typeLabel=layerGroup==='hydro'?(source.hydroCategory==='lake'?'호수':'강'):layerGroup==='genericFeatures'?(source.meta?.split(' · ')[0]||TYPE_LABELS[layerGroup]):TYPE_LABELS[layerGroup]||layerGroup;
    rows.set(key,{...source,kind:'object',key,ref,layerGroup,typeLabel});
  }
  const order=(a,b)=>compare({name:a.name,id:''},{name:b.name,id:''})||(a.key<b.key?-1:a.key>b.key?1:0);
  return Object.freeze({items:Object.freeze([...rows.values()].sort(order))});
}
export function visibleObjectSearchRows(model,search='') {
  const query=search.trim().toLocaleLowerCase('ko');
  if(!query)return [];
  return model.items.filter(item=>[item.name,item.typeLabel,item.searchText||'',item.id].join(' ').toLocaleLowerCase('ko').includes(query));
}
