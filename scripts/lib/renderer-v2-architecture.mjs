import {parseJavaScript,walkJavaScript} from './source-analysis.mjs';

/** Check the scheduled owner's device/resources and required initialization receipts. */
export function auditSharedGpuPassInitialization(source) {
  const code=parseJavaScript(source),owners=[];
  walkJavaScript(code,node=>{
    if(node.type==='FunctionDeclaration'&&node.id?.name==='initializeSharedGpuPasses')owners.push(node);
  });
  if(owners.length!==1)return ['renderer must own one shared GPU pass initializer'];
  const statements=owners[0].body.body;
  const declaration=name=>statements.flatMap(node=>node.type==='VariableDeclaration'?node.declarations:[])
    .find(node=>node.id.type==='Identifier'&&node.id.name===name)?.init;
  const property=(node,name)=>node?.type==='ObjectExpression'
    ?node.properties.find(value=>value.type==='Property'&&!value.computed&&value.key.name===name)?.value:null;
  const path=node=>node?.type==='Identifier'?node.name:node?.type==='MemberExpression'&&!node.computed&&!node.optional
    ?`${path(node.object)}.${node.property.name}`:null;
  const call=(node,name)=>node?.type==='CallExpression'&&!node.optional&&path(node.callee)===name;
  const entry=declaration('entry'),initialize=declaration('initialize'),failures=[];
  if(path(property(entry,'device'))!=='renderDevice'||path(property(entry,'selection'))!=='selectionPass')
    failures.push('shared GPU initialization must capture the main renderer device and selection pass');
  if(initialize?.type!=='ArrowFunctionExpression'||!initialize.async||initialize.body.type!=='BlockStatement')
    return [...failures,'shared GPU pass initialization must await required results'];
  const required=(statement,selection=false)=>{
    if(statement.type!=='IfStatement')return null;
    const consequent=statement.consequent.type==='BlockStatement'&&statement.consequent.body.length===1
      ?statement.consequent.body[0]:statement.consequent;
    if(consequent.type!=='ThrowStatement')return null;
    let condition=statement.test;
    if(selection){
      if(condition.type!=='LogicalExpression'||condition.operator!=='&&'||path(condition.left)!=='entry.selection')return null;
      condition=condition.right;
    }
    return condition.type==='BinaryExpression'&&condition.operator==='!=='&&condition.right.type==='Literal'
      &&condition.right.value===true&&condition.left.type==='AwaitExpression'?condition.left.argument:null;
  };
  const queued=(node,stage)=>call(node,'enqueue')&&node.arguments[0]?.value===stage
    &&node.arguments[1]?.type==='ArrowFunctionExpression'?node.arguments[1].body:null;
  const steps=initialize.body.body;
  const polygon=steps.findIndex(statement=>{
    const init=queued(required(statement),'polygon');
    return call(init,'polygonOverlayPass.initialize')&&path(init.arguments[0])==='entry.device';
  });
  const stroke=steps.findIndex(statement=>{
    const init=required(statement);
    return call(init,'strokeRenderer.initializeProgressively')&&path(init.arguments[0])==='entry.device'
      &&path(init.arguments[1])==='enqueue';
  });
  const selection=steps.findIndex(statement=>{
    const init=queued(required(statement,true),'selection');
    return call(init,'entry.selection.initialize')&&path(init.arguments[0])==='entry.device'
      &&path(property(init.arguments[1],'strokeRenderer'))==='strokeRenderer'
      &&path(property(init.arguments[1],'polygonPass'))==='polygonOverlayPass';
  });
  if(polygon<0||stroke<=polygon||selection<=stroke)
    failures.push('shared GPU passes must require true receipts in polygon, stroke and selection order with shared resources');
  return failures;
}

export const PROJECT_RENDERER_SEQUENCE = Object.freeze([
  'base',
  'hydro',
  'hydroEdits',
  'territorialUnits',
  'distributions',
  'genericFeatures',
  'stackOverlays',
  'projectedOverlays',
  'countries',
  'geometryPreview',
  'validation',
  'boundaryEdit',
  'vertices',
  'draft',
  'snapIndicator',
  'selectionData',
  'labelLayout',
  'territorialLabels',
  'userLabels',
  'viewPresentation',
  'objectSearch',
  'debug',
]);

export const REQUIRED_STROKE_SOURCE_MARKERS = Object.freeze([
  'GPU_STROKE_FLAGS',
  'aPrevious',
  'aNext',
  'ownerNodeRanges',
  'uMiterLimit',
  'uAaRadius',
  'smoothstep(-uAaRadius,uAaRadius,edge)',
  'connectedTopology: true',
  'analyticAa: true',
]);
