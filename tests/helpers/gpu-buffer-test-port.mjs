// Deliberately minimal WebGL buffer port, shared by resource-owner and upload tests.
// Each invocation owns its allocation and deletion log; no global GL state leaks.
export function createTrackedGlBufferPort({withUploads=false}={}) {
  const created=[], deleted=[];
  const gl={
    createBuffer() { const buffer={}; created.push(buffer); return buffer; },
    deleteBuffer(buffer) { deleted.push(buffer); },
  };
  if(withUploads)Object.assign(gl,{
    bindBuffer() {},bufferData() {},bufferSubData() {},
    isBuffer: value=>typeof value==='object',
  });
  return {gl,created,deleted};
}
