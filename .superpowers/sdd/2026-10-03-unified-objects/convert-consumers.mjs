import fs from 'node:fs';import {createRequire} from 'node:module';
const req=createRequire(import.meta.url),{parse}=createRequire(req.resolve('eslint'))('espree');
const files=fs.readdirSync('assets/js/modules').filter(f=>f.endsWith('.js')).map(f=>'assets/js/modules/'+f);
const unwrap=n=>n?.type==='ChainExpression'?n.expression:n;
const label=n=>{n=unwrap(n);if(n?.type==='Literal'&&['country','subunit','region'].includes(n.value))return n.value;
 if(n?.type==='MemberExpression'&&['COUNTRY','SUBUNIT','REGION'].includes(n.property?.name)&&n.object?.property?.name==='TERRITORIAL_UNIT_TYPES')return n.property.name.toLowerCase();
 if(n?.type==='MemberExpression'&&n.object?.name==='TERRITORIAL_UNIT_TYPES')return n.property.name.toLowerCase();return null;};
for(const p of files){if(p.endsWith('/territorial-units.js'))continue;let s=fs.readFileSync(p,'utf8'),edits=[];const txt=n=>s.slice(...n.range);
 const condition=(props,type)=>type==='region'?`${props}.entityKind === 'regional'`:`${props}.entityKind === 'general' && ${type==='country'?'!':'!!'}${props}.parentId`;
 function visit(n){if(!n||typeof n!=='object')return;
 if(n.type==='BinaryExpression'&&['===','!==','==','!='].includes(n.operator)){
  let member=unwrap(n.left),type=label(n.right);if(member?.property?.name!=='unitType'){member=unwrap(n.right);type=label(n.left);}
  if(type&&member?.type==='MemberExpression'&&member.property.name==='unitType'){
   const props=txt(member.object);const optional=member.optional?'?':'';
   const c=condition(props+optional,type);edits.push([n.range[0],n.range[1],`${n.operator.includes('!')?'!':''}(${c})`]);return;
  }
 }
 if(n.type==='ObjectExpression'){
  const domain=n.properties.find(x=>x.key?.name==='domain'&&x.value?.value==='territorial');
  if(domain){const type=n.properties.find(x=>x.key?.name==='type');if(type)edits.push([type.value.range[0],type.value.range[1],"'entity'"]);}
  for(const prop of n.properties){if(prop.key?.name==='unitType'&&label(prop.value)){edits.push([prop.range[0],prop.range[1],`entityKind: '${label(prop.value)==='region'?'regional':'general'}'`]);}}
 }
 for(const[k,v]of Object.entries(n))if(k!=='range'){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}
 }
 visit(parse(s,{ecmaVersion:'latest',sourceType:'module',range:true}));
 const sorted=edits.sort((a,b)=>b[0]-a[0]);let last=s.length;for(const[a,b,v]of sorted){if(b>last)continue;s=s.slice(0,a)+v+s.slice(b);last=a;}
 s=s.replaceAll('administrativeCountryId','territorialRootId').replace(/\.administrativeCountry\(/g,'.root(');
 if(s!==fs.readFileSync(p,'utf8'))fs.writeFileSync(p,s);
}
