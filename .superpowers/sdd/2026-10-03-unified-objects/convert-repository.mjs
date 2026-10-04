import fs from 'node:fs';import {createRequire} from 'node:module';const req=createRequire(import.meta.url),{parse}=createRequire(req.resolve('eslint'))('espree');
for(const f of fs.readdirSync('assets/js/modules').filter(f=>f.endsWith('.js'))){const p='assets/js/modules/'+f;let s=fs.readFileSync(p,'utf8');const edits=[];const text=n=>s.slice(...n.range);
 function visit(n){if(!n||typeof n!=='object')return;
 if(n.type==='CallExpression'&&['list','children','descendants','siblings'].includes(n.callee?.property?.name)&&/entityRepository|EntityRepository/.test(text(n.callee.object))){
 const obj=n.arguments.find(n=>n.type==='ObjectExpression');if(obj){const prop=obj.properties.find(p=>p.key?.name==='type');const vals=prop?.value.type==='ArrayExpression'?prop.value.elements.map(n=>n.value):[prop?.value.value];
 if(prop&&vals.every(v=>['country','subunit','region'].includes(v))){
 let filter='';const other=obj.properties.filter(p=>p!==prop).map(text);if(vals.length===1){const type=vals[0];other.push(`kind: '${type==='region'?'regional':'general'}'`);if(type==='country')other.push("parentId: ''");if(type==='subunit'&&n.callee.property.name==='list')filter='.filter(entity => !!entity.properties.parentId)';}
 else if(vals.includes('subunit')&&vals.includes('region')&&!vals.includes('country'))filter=".filter(entity => entity.properties.entityKind === 'regional' || !!entity.properties.parentId)";
 const args=n.arguments.map(arg=>arg===obj?`{ ${other.join(', ')} }`:text(arg));edits.push([n.range[0],n.range[1],`${text(n.callee)}(${args.join(', ')})${filter}`]);return;
 }
 }
 }
 for(const[k,v]of Object.entries(n))if(k!=='range'){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}
 }visit(parse(s,{ecmaVersion:'latest',sourceType:'module',range:true}));
 for(const[a,b,v]of edits.sort((a,b)=>b[0]-a[0]))s=s.slice(0,a)+v+s.slice(b);
 // Repository root filter name is distinct from the hierarchy calculation function.
 s=s.replace(/list\(\{ territorialRootId:/g,'list({ rootId:');
 if(s!==fs.readFileSync(p,'utf8'))fs.writeFileSync(p,s);
}
