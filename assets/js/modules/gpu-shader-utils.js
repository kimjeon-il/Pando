function shaderLabel(label, fallback) {
  const value = String(label || '').trim();
  return value || fallback;
}

export function compileGpuShader(gl, type, source, { label = 'shader' } = {}) {
  if (!gl) throw new Error(`${shaderLabel(label, 'shader')} context unavailable`);
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`${shaderLabel(label, 'shader')} allocation failed`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || `${shaderLabel(label, 'shader')} compile failed`;
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function linkGpuProgram(gl, vertexSource, fragmentSource, { label = 'program' } = {}) {
  if (!gl) throw new Error(`${shaderLabel(label, 'program')} context unavailable`);
  const vertex = compileGpuShader(gl, gl.VERTEX_SHADER, vertexSource, { label: `${label} vertex shader` });
  let fragment = null;
  let program;
  try {
    fragment = compileGpuShader(gl, gl.FRAGMENT_SHADER, fragmentSource, { label: `${label} fragment shader` });
    program = gl.createProgram();
    if (!program) throw new Error(`${shaderLabel(label, 'program')} allocation failed`);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) || `${shaderLabel(label, 'program')} link failed`;
        gl.deleteProgram(program);
        throw new Error(message);
      }
    return program;
  } finally {
    gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}

export function deleteGpuProgram(gl, program) {
  if (gl && program) gl.deleteProgram(program);
}
