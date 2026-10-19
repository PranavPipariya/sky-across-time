// Section 6.7: horizon silhouette pass (shader in horizon.frag).
import { program, QUAD_VERT } from './gl.js';
import common from './common.glsl?raw';
import frag from './horizon.frag?raw';

export const FRAG_HEAD = '#version 300 es\nprecision highp float;\nout vec4 fragColor;\n';

export function createHorizon(ctx, quad) {
  const { gl } = ctx;
  const prog = program(ctx, QUAD_VERT, FRAG_HEAD + common + frag);
  return {
    prog,
    draw(setView, place) {
      gl.useProgram(prog.p);
      setView(prog);
      gl.uniform1f(prog.u.uTree, place.tree);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(prog.a.aPos);
      gl.vertexAttribPointer(prog.a.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    },
  };
}
