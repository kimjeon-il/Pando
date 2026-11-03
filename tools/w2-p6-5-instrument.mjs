// Diagnostic routes only: both fixed versions receive the same markers.
export function instrument(path,source){
 const once=(a,b)=>{if(source.split(a).length!==2)throw Error('W65 diagnostic anchor: '+path+' '+a);source=source.replace(a,b);};
 if(path.includes('country-shared-boundary-worker.js')){
  const mark=(stage,edge)=>`performance.mark('W65|'+JSON.stringify({stage:'${stage}',edge:'${edge}',requestId:message.requestId,generation:message.projectGeneration}));`;
  once('async function prepareMessage(message) {','async function prepareMessage(message) {'+mark('worker-process','start'));
  once('    const features = [];',`    ${mark('digest','start')}const features = [];`);
  once('    let changed, cacheSeeded = false;',`    ${mark('digest','end')}let changed, cacheSeeded = false;`);
  once('    const packetPreparationStarted = performance.now();',`    ${mark('packet','start')}const packetPreparationStarted = performance.now();`);
  once('    const packetPreparationMs = performance.now() - packetPreparationStarted;',`    const packetPreparationMs = performance.now() - packetPreparationStarted;${mark('packet','end')}`);
  once('self.onmessage = ({ data }) => {',"self.onmessage = ({ data }) => {performance.mark('W65|'+JSON.stringify({stage:'worker-receive',requestId:data?.requestId,generation:data?.projectGeneration,type:data?.type}));");
 }
 if(path.includes('/modules/gpu-map-renderer.js'))once('      countrySharedBoundary = packet;',"      countrySharedBoundary = packet;performance.mark('W65|'+JSON.stringify({stage:'boundary-published',generation:packet.sourceProjectGeneration,quality:packet.sourceQuality}));");
 return source;
}
