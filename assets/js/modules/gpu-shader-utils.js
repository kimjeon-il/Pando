// Driver sin/cos can exceed one CSS pixel at flatZoom=64 even in highp.
// Range-reduced polynomials keep all geographic vertex shaders on one precise
// spherical projection; triangulation precision cannot correct shader drift.
export const GPU_SPHERICAL_POSITION_GLSL = `
  vec2 gpuSinCos(float angle) {
    float x = angle - floor((angle + 3.141592653589793) / 6.283185307179586) * 6.283185307179586;
    float signCos = 1.0;
    if (x > 1.570796326794897) { x = 3.141592653589793 - x; signCos = -1.0; }
    else if (x < -1.570796326794897) { x = -3.141592653589793 - x; signCos = -1.0; }
    float z = x * x;
    float s = x * (1.0 + z * (-0.166666666666667 + z * (0.008333333333333 + z * (-0.000198412698413 + z * (0.000002755731922 + z * (-0.000000025052108 + z * (0.000000000160590 - z * 0.000000000000765)))))));
    float c = 1.0 + z * (-0.5 + z * (0.041666666666667 + z * (-0.001388888888889 + z * (0.000024801587302 + z * (-0.000000275573192 + z * (0.000000002087676 - z * 0.000000000011471))))));
    return vec2(s, signCos * c);
  }
  vec3 gpuUnitSphere(float longitude, float latitude) {
    vec2 lon = gpuSinCos(longitude), lat = gpuSinCos(latitude);
    return vec3(lat.y * lon.y, lat.y * lon.x, lat.x);
  }
`;

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
