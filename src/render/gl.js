// Small WebGL helpers. Shaders are written in GLSL ES 3.00 and down-converted for WebGL1.

export function createContext(canvas) {
  const opts = { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
  let gl = canvas.getContext('webgl2', opts);
  const isGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  if (!gl) return null;
  const ext = {};
  if (!isGL2) {
    ext.derivatives = gl.getExtension('OES_standard_derivatives');
    ext.lod = gl.getExtension('EXT_shader_texture_lod');
  }
  ext.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  return { gl, isGL2, ext };
}

function toGL1(src, type, ext) {
  let s = src.replace(/^#version 300 es\s*/, '');
  const head = [];
  if (type === 'frag') {
    if (ext.derivatives) head.push('#extension GL_OES_standard_derivatives : enable');
    if (ext.lod) head.push('#extension GL_EXT_shader_texture_lod : enable', '#define HAS_LOD 1');
    s = s.replace(/^\s*out\s+vec4\s+\w+\s*;/m, '').replace(/\bfragColor\b/g, 'gl_FragColor').replace(/\bin\s+(?=\w+\s+\w+\s*;)/g, 'varying ');
    s = s.replace(/\btextureGrad\s*\(/g, ext.lod ? 'texture2DGradEXT(' : 'tex2DGradFallback(');
    if (!ext.lod) head.push('#define tex2DGradFallback(t, uv, dx, dy) texture2D(t, uv)');
    if (!ext.derivatives) head.push('#define dFdx(x) (x*0.0)', '#define dFdy(x) (x*0.0)', '#define fwidth(x) (x*0.0+0.001)');
  } else {
    s = s.replace(/\bin\s+(?=\w+\s+\w+\s*;)/g, 'attribute ').replace(/\bout\s+(?=\w+\s+\w+\s*;)/g, 'varying ');
  }
  s = s.replace(/\btexture\s*\(/g, 'texture2D(');
  return head.join('\n') + '\n' + s;
}

export function program(ctx, vsrc, fsrc) {
  const { gl, isGL2, ext } = ctx;
  const compile = (type, src) => {
    const sh = gl.createShader(type === 'vert' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
    gl.shaderSource(sh, isGL2 ? src : toGL1(src, type, ext));
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + src);
    return sh;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile('vert', vsrc));
  gl.attachShader(p, compile('frag', fsrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, info.name);
  }
  const attribs = {};
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(p, i);
    attribs[info.name] = gl.getAttribLocation(p, info.name);
  }
  return { p, u: uniforms, a: attribs };
}

/** Uploads an image as a mipmapped, clamped texture. */
export function textureFromImage(ctx, img) {
  const { gl, ext } = ctx;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (ext.aniso) gl.texParameterf(gl.TEXTURE_2D, ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
  return t;
}

export function blankTexture(ctx) {
  const { gl } = ctx;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  return t;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** A full-screen quad buffer, attribute 'aPos' in clip space. */
export function quadBuffer(gl) {
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return b;
}

export const QUAD_VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Leaves no stray vertex arrays enabled between passes. */
export function resetAttribs(gl) {
  for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
}
