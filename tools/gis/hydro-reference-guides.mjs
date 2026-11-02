// Reassemble Natural Earth river rows before selecting their guide lines.
function lineParts(geometry){
  const parts=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
  if(!Array.isArray(parts))throw Error('Invalid Hydro reference geometry');
  return parts.map(part=>{
    if(!Array.isArray(part))throw Error('Invalid Hydro reference line');
    return part.map(point=>{
      if(!Array.isArray(point)||point.length<2||!Number.isFinite(Number(point[0]))||!Number.isFinite(Number(point[1])))
        throw Error('Invalid Hydro reference coordinate');
      return [Number(point[0]),Number(point[1])];
    });
  });
}
export function prepareHydroReferenceGuides(rows){
  if(!Array.isArray(rows))throw Error('Explicit Hydro reference rows required');
  const groups=new Map();
  for(let i=0;i<rows.length;i++){
    const row=rows[i],properties=row?.properties??{};
    if(!row||typeof properties!=='object'||Array.isArray(properties))throw Error('Invalid Hydro reference feature');
    const key=String(properties.pandolab_id||row.id||`ne-river-row:${i}`);
    if(!groups.has(key))groups.set(key,{feature:{type:'Feature',id:key,properties:structuredClone(properties),geometry:null},parts:[]});
    const group=groups.get(key),current=group.feature.properties;for(const part of lineParts(row.geometry))group.parts.push(part);
    const currentZoom=Number(current.min_zoom??99),rowZoom=Number(properties.min_zoom??99);
    const currentWidth=Number(current.stroke_width||0),rowWidth=Number(properties.stroke_width||0);
    if([currentZoom,rowZoom,currentWidth,rowWidth].some(value=>!Number.isFinite(value)))throw Error('Invalid Hydro reference display metadata');
    current.min_zoom=Math.min(currentZoom,rowZoom);current.stroke_width=Math.max(currentWidth,rowWidth);
    for(const name of ['name_ko','name_en','name'])if(!current[name]&&properties[name])current[name]=properties[name];
  }
  const features=[],lines=[],names=[];
  for(const {feature,parts} of groups.values()){
    feature.geometry=parts.length===1?{type:'LineString',coordinates:parts[0]}:{type:'MultiLineString',coordinates:parts};
    features.push(feature);const name=String(feature.properties.name_ko||feature.properties.name_en||feature.properties.name||'').trim();
    for(const part of parts)if(part.length>=2){lines.push(part);names.push(name);}
  }
  return {features,lines,names};
}
