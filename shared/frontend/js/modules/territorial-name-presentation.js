// Formatting only: the C++ timeline has already selected and validated names.
export function presentTerritorialNames(document,host,names) {
  const rows=[];
  const append=(label,value)=>{
    if(!value)return;
    const row=document.createElement('div');row.className='editor-name-detail';
    const term=document.createElement('dt'),description=document.createElement('dd');
    term.textContent=label;description.textContent=value;row.append(term,description);rows.push(row);
  };
  const language=(label,value)=>{
    if(!value)return;
    append(`${label} 통칭`,value.common);append(`${label} 정식명`,value.formal);
    if(value.aliases?.length)append(`${label} 별칭`,value.aliases.join(', '));
  };
  language('한국어',names?.ko);language('영어',names?.en);
  for(const native of names?.native || [])language(`원어 (${native.language})`,native);
  host.replaceChildren(...rows);host.hidden=!rows.length;
}
