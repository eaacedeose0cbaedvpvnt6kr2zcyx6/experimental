/* meshify.js — real triangle meshes from the engine's oriented point cloud.

   The story scenes are bespoke per-point procedural math (217 raw set() calls across the two
   pages), so there are no parametric primitives to recover. What every scene DOES keep on the
   CPU is a world-space position and a surface normal per point — engine.js stores them in its
   scene cache as {pts: Float32Array(N*4), nrm: Float32Array(N)}. Oriented points are exactly
   the input a surface reconstruction wants, so we rebuild the art rather than reinvent it.

   Method: Naive Surface Nets over a Hoppe-style tangent-plane signed field.
     f(p) = Σ w_i · dot(n_i, p - x_i) / Σ w_i        w_i = exp(-|p-x_i|² / r²)
   Surface Nets needs no 256-entry case tables (unlike marching cubes), is watertight, and
   yields smoother surfaces — a better match for a cloud than hard MC facets. It walks the
   volume two z-slices at a time, so peak memory stays at O(res²) instead of O(res³).

   Speed: the cloud is a thin shell, so most of the volume is empty. A dilated occupancy mask
   over the neighbour grid turns an empty-space field query into a single array lookup, which
   is what keeps a 450k-point scene in the hundreds of milliseconds rather than minutes.

   Output: real THREE.Mesh objects with MeshStandardMaterial — raycastable, onBeforeCompile
   patchable, and usable as `targets` for scanReveal exactly as a loaded glTF model would be.  */
(function (root) {
  'use strict';

  // motion classes that stay glowing points and never become surface (engine.js data model)
  // class 18 (prophets, angels) is absent: they now reconstruct as surface like any other figure
var GLOW_ONLY = { 4: 1, 6: 1, 8: 1, 9: 1, 10: 1, 15: 1, 16: 1 };

  var CFG = {
    voxelsPerSpacing: 1.45, // voxel size = spacing * this; drives resolution off the scene's own density
    maxRes: 160,            // hard cap on voxels along a chunk's longest axis
    radiusCells: 1.8,       // field support radius, in voxels
    isoLevel: 0.0,
    minNeighbours: 4,       // fewer supporting points than this reads as empty space
    chunkTarget: 8,         // split the volume into ~this many meshes
    smoothIters: 3,
    smoothAmount: 0.55,
    minVertsPerChunk: 24
  };

  // ---- octahedral unpack, mirroring packN() in engine.js -------------------------------
  function unpackN(p, out) {
    var a = Math.floor(p / 256), b = p - a * 256;
    var u = a / 255 * 2 - 1, v = b / 255 * 2 - 1;
    var y = 1 - Math.abs(u) - Math.abs(v), x = u, z = v;
    if (y < 0) {
      var xx = (1 - Math.abs(z)) * (x >= 0 ? 1 : -1);
      var zz = (1 - Math.abs(x)) * (z >= 0 ? 1 : -1);
      x = xx; z = zz;
    }
    var l = Math.hypot(x, y, z) || 1;
    out[0] = x / l; out[1] = y / l; out[2] = z / l;
    return out;
  }

  /* ---- neighbour grid ------------------------------------------------------------------
     Counting-sort buckets (the layout engine.js uses in buildLines): count per cell, prefix
     sum, scatter. Cell size is set to the field support radius, so a query only ever needs
     the 27 cells around it. `near` marks cells whose 27-neighbourhood holds any point.     */
  function buildIndex(px, py, pz, n, cell) {
    var minx = Infinity, miny = Infinity, minz = Infinity;
    var maxx = -Infinity, maxy = -Infinity, maxz = -Infinity, i;
    for (i = 0; i < n; i++) {
      if (px[i] < minx) minx = px[i]; if (px[i] > maxx) maxx = px[i];
      if (py[i] < miny) miny = py[i]; if (py[i] > maxy) maxy = py[i];
      if (pz[i] < minz) minz = pz[i]; if (pz[i] > maxz) maxz = pz[i];
    }
    var nx = Math.max(1, Math.ceil((maxx - minx) / cell) + 1);
    var ny = Math.max(1, Math.ceil((maxy - miny) / cell) + 1);
    var nz = Math.max(1, Math.ceil((maxz - minz) / cell) + 1);
    var total = nx * ny * nz;
    var counts = new Uint32Array(total + 1);
    var ci = new Int32Array(n);
    for (i = 0; i < n; i++) {
      var gx = Math.min(nx - 1, Math.max(0, Math.floor((px[i] - minx) / cell)));
      var gy = Math.min(ny - 1, Math.max(0, Math.floor((py[i] - miny) / cell)));
      var gz = Math.min(nz - 1, Math.max(0, Math.floor((pz[i] - minz) / cell)));
      var c = (gz * ny + gy) * nx + gx;
      ci[i] = c; counts[c + 1]++;
    }
    for (i = 0; i < total; i++) counts[i + 1] += counts[i];
    var fill = counts.slice(0, total), order = new Uint32Array(n);
    for (i = 0; i < n; i++) order[fill[ci[i]]++] = i;

    // dilate occupancy by one cell so an empty-space query is a single lookup
    var near = new Uint8Array(total);
    for (var gz2 = 0; gz2 < nz; gz2++) {
      for (var gy2 = 0; gy2 < ny; gy2++) {
        for (var gx2 = 0; gx2 < nx; gx2++) {
          var c2 = (gz2 * ny + gy2) * nx + gx2;
          if (counts[c2 + 1] === counts[c2]) continue;
          for (var dz = -1; dz <= 1; dz++) {
            var z2 = gz2 + dz; if (z2 < 0 || z2 >= nz) continue;
            for (var dy = -1; dy <= 1; dy++) {
              var y2 = gy2 + dy; if (y2 < 0 || y2 >= ny) continue;
              for (var dx = -1; dx <= 1; dx++) {
                var x2 = gx2 + dx; if (x2 < 0 || x2 >= nx) continue;
                near[(z2 * ny + y2) * nx + x2] = 1;
              }
            }
          }
        }
      }
    }
    return {
      minx: minx, miny: miny, minz: minz, maxx: maxx, maxy: maxy, maxz: maxz,
      nx: nx, ny: ny, nz: nz, cell: cell, counts: counts, order: order, near: near
    };
  }

  /* ---- tangent-plane signed field -----------------------------------------------------
     NaN where no oriented point supports the query. The mesher reads NaN as "not part of the
     model" and emits nothing, which is what stops sprinkled shells (terrain, crowds, star
     spheres) from closing up into blobs.                                                   */
  function makeField(ix, r2, nX, nY, nZ, px, py, pz, minNb) {
    var cell = ix.cell, nx = ix.nx, ny = ix.ny, nz = ix.nz;
    var minx = ix.minx, miny = ix.miny, minz = ix.minz;
    var counts = ix.counts, order = ix.order, near = ix.near;
    return function (x, y, z) {
      var gx = (x - minx) / cell | 0, gy = (y - miny) / cell | 0, gz = (z - minz) / cell | 0;
      if (gx < 0 || gy < 0 || gz < 0 || gx >= nx || gy >= ny || gz >= nz) return NaN;
      if (!near[(gz * ny + gy) * nx + gx]) return NaN;   // single-lookup empty-space reject
      var wsum = 0, fsum = 0, hits = 0;
      var zlo = gz > 0 ? gz - 1 : 0, zhi = gz < nz - 1 ? gz + 1 : nz - 1;
      var ylo = gy > 0 ? gy - 1 : 0, yhi = gy < ny - 1 ? gy + 1 : ny - 1;
      var xlo = gx > 0 ? gx - 1 : 0, xhi = gx < nx - 1 ? gx + 1 : nx - 1;
      for (var cz = zlo; cz <= zhi; cz++) {
        for (var cy = ylo; cy <= yhi; cy++) {
          var base = (cz * ny + cy) * nx;
          var s = counts[base + xlo], e = counts[base + xhi + 1];
          for (var k = s; k < e; k++) {
            var i = order[k];
            var ex = x - px[i], ey = y - py[i], ez = z - pz[i];
            var d2 = ex * ex + ey * ey + ez * ez;
            if (d2 > r2) continue;
            var w = 1 - d2 / r2;      // cheap compact kernel; exp() here is a measurable cost
            w *= w;
            fsum += w * (ex * nX[i] + ey * nY[i] + ez * nZ[i]);
            wsum += w; hits++;
          }
        }
      }
      if (hits < minNb || wsum <= 1e-9) return NaN;
      return fsum / wsum;
    };
  }

  // cube corners, ordered so index = x + 2y + 4z
  var CX = [0, 1, 0, 1, 0, 1, 0, 1];
  var CY = [0, 0, 1, 1, 0, 0, 1, 1];
  var CZ = [0, 0, 0, 0, 1, 1, 1, 1];
  var EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];   // 12 edges, endpoint A
  var EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];   // 12 edges, endpoint B

  /* ---- Naive Surface Nets -------------------------------------------------------------
     One vertex per sign-changing cell at the mean of its edge crossings; a quad for every
     grid edge whose endpoints straddle the isosurface. Rolling two-slice buffers, and no
     allocation inside the per-voxel loop.                                                 */
  function surfaceNets(field, b, rx, ry, rz, iso, minVerts) {
    var x0 = b[0], y0 = b[1], z0 = b[2];
    var sx = (b[3] - x0) / rx, sy = (b[4] - y0) / ry, sz = (b[5] - z0) / rz;
    var nxp = rx + 1, nyp = ry + 1, sliceLen = nxp * nyp;

    var prevF = new Float32Array(sliceLen), curF = new Float32Array(sliceLen);
    var prevIdx = new Int32Array(sliceLen), curIdx = new Int32Array(sliceLen);
    var positions = [], indices = [];
    var v = new Float32Array(8);
    var i;

    function sampleSlice(kz, out) {
      var z = z0 + kz * sz;
      for (var iy = 0; iy < nyp; iy++) {
        var y = y0 + iy * sy, row = iy * nxp;
        for (var ix2 = 0; ix2 < nxp; ix2++) out[row + ix2] = field(x0 + ix2 * sx, y, z);
      }
    }

    /* Winding: the field is positive OUTSIDE the surface (it is a signed distance along the
       point normals, which point outward), so the corner-0-negative case is the one that needs
       reversing for front faces to end up facing out. Getting this backwards renders every
       surface inside-out and makes FrontSide raycasting miss entirely. */
    function quad(a, b2, c, d, flip) {
      if (a < 0 || b2 < 0 || c < 0 || d < 0) return;
      if (flip) { indices.push(a, b2, c, a, c, d); }
      else { indices.push(a, d, c, a, c, b2); }
    }

    sampleSlice(0, prevF);
    prevIdx.fill(-1);

    for (var kz = 1; kz <= rz; kz++) {
      sampleSlice(kz, curF);
      curIdx.fill(-1);

      for (var iy = 0; iy < ry; iy++) {
        var r0 = iy * nxp, r1 = (iy + 1) * nxp;
        for (var ix2 = 0; ix2 < rx; ix2++) {
          v[0] = prevF[r0 + ix2]; v[1] = prevF[r0 + ix2 + 1];
          v[2] = prevF[r1 + ix2]; v[3] = prevF[r1 + ix2 + 1];
          v[4] = curF[r0 + ix2];  v[5] = curF[r0 + ix2 + 1];
          v[6] = curF[r1 + ix2];  v[7] = curF[r1 + ix2 + 1];

          var bad = 0, neg = 0;
          for (i = 0; i < 8; i++) {
            var s = v[i];
            if (s !== s) { bad = 1; break; }
            if (s < iso) neg++;
          }
          if (bad || neg === 0 || neg === 8) continue;

          var ax = 0, ay = 0, az = 0, cnt = 0;
          for (i = 0; i < 12; i++) {
            var a = EA[i], bb = EB[i], va = v[a], vb = v[bb];
            if ((va < iso) === (vb < iso)) continue;
            var t = (iso - va) / (vb - va);
            ax += CX[a] + (CX[bb] - CX[a]) * t;
            ay += CY[a] + (CY[bb] - CY[a]) * t;
            az += CZ[a] + (CZ[bb] - CZ[a]) * t;
            cnt++;
          }
          if (!cnt) continue;
          var vi = positions.length / 3;
          positions.push(
            x0 + (ix2 + ax / cnt) * sx,
            y0 + (iy + ay / cnt) * sy,
            z0 + (kz - 1 + az / cnt) * sz
          );
          curIdx[r0 + ix2] = vi;

          /* For each axis edge leaving corner 0 that straddles the surface, the four cells
             sharing that edge each own a vertex — join them into a quad. curIdx is the cell
             layer at kz-1, prevIdx the layer at kz-2.                                      */
          var c0 = v[0] < iso;
          // +z edge (0->4): ring of cells in x,y, all in the current layer
          if (ix2 > 0 && iy > 0 && c0 !== (v[4] < iso))
            quad(vi, curIdx[r0 + ix2 - 1], curIdx[r0 - nxp + ix2 - 1], curIdx[r0 - nxp + ix2], c0);
          // +y edge (0->2): ring of cells in x,z
          if (ix2 > 0 && kz > 1 && c0 !== (v[2] < iso))
            quad(vi, prevIdx[r0 + ix2], prevIdx[r0 + ix2 - 1], curIdx[r0 + ix2 - 1], c0);
          // +x edge (0->1): ring of cells in y,z
          if (iy > 0 && kz > 1 && c0 !== (v[1] < iso))
            quad(vi, curIdx[r0 - nxp + ix2], prevIdx[r0 - nxp + ix2], prevIdx[r0 + ix2], c0);
        }
      }
      var tf = prevF; prevF = curF; curF = tf;
      var ti = prevIdx; prevIdx = curIdx; curIdx = ti;
    }

    if (positions.length / 3 < minVerts || !indices.length) return null;
    return { positions: positions, indices: indices };
  }

  // Laplacian relaxation — takes the stair-stepping off the voxel grid.
  function smooth(positions, indices, iters, amount) {
    var n = positions.length / 3, i, k;
    var accum = new Float32Array(positions.length), deg = new Uint16Array(n);
    for (k = 0; k < iters; k++) {
      accum.fill(0); deg.fill(0);
      for (i = 0; i < indices.length; i += 3) {
        for (var e = 0; e < 3; e++) {
          var a = indices[i + e], b = indices[i + (e + 1) % 3];
          accum[a * 3] += positions[b * 3]; accum[a * 3 + 1] += positions[b * 3 + 1]; accum[a * 3 + 2] += positions[b * 3 + 2];
          accum[b * 3] += positions[a * 3]; accum[b * 3 + 1] += positions[a * 3 + 1]; accum[b * 3 + 2] += positions[a * 3 + 2];
          deg[a] += 1; deg[b] += 1;
        }
      }
      for (i = 0; i < n; i++) {
        if (!deg[i]) continue;
        for (var c = 0; c < 3; c++) {
          var avg = accum[i * 3 + c] / deg[i];
          positions[i * 3 + c] += (avg - positions[i * 3 + c]) * amount;
        }
      }
    }
  }

  // ---- filter the cloud down to the classes that become surface ------------------------
  function prepare(pts, nrm, count) {
    var px = new Float32Array(count), py = new Float32Array(count), pz = new Float32Array(count);
    var nX = new Float32Array(count), nY = new Float32Array(count), nZ = new Float32Array(count);
    var tmp = [0, 0, 0], n = 0;
    for (var i = 0; i < count; i++) {
      var w = pts[i * 4 + 3];
      var motion = Math.floor((w % 128) / 4);
      if (GLOW_ONLY[motion]) continue;
      px[n] = pts[i * 4]; py[n] = pts[i * 4 + 1]; pz[n] = pts[i * 4 + 2];
      unpackN(nrm[i], tmp);
      nX[n] = tmp[0]; nY[n] = tmp[1]; nZ[n] = tmp[2];
      n++;
    }
    return { px: px, py: py, pz: pz, nX: nX, nY: nY, nZ: nZ, n: n };
  }

  function chunkBounds(ix, cfg, pad) {
    var spanX = ix.maxx - ix.minx, spanY = ix.maxy - ix.miny, spanZ = ix.maxz - ix.minz;
    var longest = Math.max(spanX, spanY, spanZ) || 1;
    var k = Math.cbrt(cfg.chunkTarget);
    var nxC = Math.max(1, Math.round(k * spanX / longest));
    var nyC = Math.max(1, Math.round(k * spanY / longest));
    var nzC = Math.max(1, Math.round(k * spanZ / longest));
    var list = [];
    for (var cz = 0; cz < nzC; cz++)
      for (var cy = 0; cy < nyC; cy++)
        for (var cx = 0; cx < nxC; cx++)
          list.push([
            ix.minx + spanX * cx / nxC - pad, ix.miny + spanY * cy / nyC - pad, ix.minz + spanZ * cz / nzC - pad,
            ix.minx + spanX * (cx + 1) / nxC + pad, ix.miny + spanY * (cy + 1) / nyC + pad, ix.minz + spanZ * (cz + 1) / nzC + pad,
            cx, cy, cz
          ]);
    return list;
  }

  function buildMesh(THREE, out, material, name, cfg) {
    if (cfg.smoothIters) smooth(out.positions, out.indices, cfg.smoothIters, cfg.smoothAmount);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
    g.setIndex(out.indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    var mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    mesh.userData.reconstructed = true;
    return mesh;
  }

  function setup(opts) {
    var cfg = Object.assign({}, CFG, opts.config || {});
    var count = opts.count || (opts.pts.length / 4);
    var p = prepare(opts.pts, opts.nrm, count);
    if (p.n < 500) return null;
    var spacing = opts.spacing || 0.2;
    var voxel = Math.max(spacing * cfg.voxelsPerSpacing, 1e-4);
    var r = voxel * cfg.radiusCells;
    var ix = buildIndex(p.px, p.py, p.pz, p.n, r);
    var field = makeField(ix, r * r, p.nX, p.nY, p.nZ, p.px, p.py, p.pz, cfg.minNeighbours);
    return { cfg: cfg, ix: ix, field: field, voxel: voxel, pad: r * 2 };
  }

  function chunkRes(b, voxel, maxRes) {
    return [
      Math.min(maxRes, Math.max(8, Math.round((b[3] - b[0]) / voxel))),
      Math.min(maxRes, Math.max(8, Math.round((b[4] - b[1]) / voxel))),
      Math.min(maxRes, Math.max(8, Math.round((b[5] - b[2]) / voxel)))
    ];
  }

  /* ---- public API ---------------------------------------------------------------------
     meshifyScene(opts) -> [THREE.Mesh]                      synchronous, blocks
     meshifySceneAsync(opts) -> Promise<[THREE.Mesh]>        time-sliced, yields to the frame
     `pts`/`nrm`/`spacing` are exactly what engine.js caches per scene.                     */
  function meshifyScene(opts) {
    var THREE = opts.THREE || root.THREE;
    var st = setup(opts); if (!st) return [];
    var material = opts.material || new THREE.MeshStandardMaterial({ color: 0xb9c4d4, roughness: 0.82, metalness: 0.0 });
    var chunks = chunkBounds(st.ix, st.cfg, st.pad), meshes = [];
    for (var i = 0; i < chunks.length; i++) {
      var b = chunks[i], res = chunkRes(b, st.voxel, st.cfg.maxRes);
      var out = surfaceNets(st.field, b, res[0], res[1], res[2], st.cfg.isoLevel, st.cfg.minVertsPerChunk);
      if (out) meshes.push(buildMesh(THREE, out, material, 'meshified_' + b[6] + '_' + b[7] + '_' + b[8], st.cfg));
    }
    return meshes;
  }

  function meshifySceneAsync(opts) {
    var THREE = opts.THREE || root.THREE;
    var onProgress = opts.onProgress;
    return new Promise(function (resolve) {
      var st = setup(opts);
      if (!st) { resolve([]); return; }
      var material = opts.material || new THREE.MeshStandardMaterial({ color: 0xb9c4d4, roughness: 0.82, metalness: 0.0 });
      var chunks = chunkBounds(st.ix, st.cfg, st.pad), meshes = [], i = 0;
      function step() {
        var t0 = performance.now();
        // one chunk per slice, but keep going while there is budget left in this frame
        do {
          var b = chunks[i], res = chunkRes(b, st.voxel, st.cfg.maxRes);
          var out = surfaceNets(st.field, b, res[0], res[1], res[2], st.cfg.isoLevel, st.cfg.minVertsPerChunk);
          if (out) meshes.push(buildMesh(THREE, out, material, 'meshified_' + b[6] + '_' + b[7] + '_' + b[8], st.cfg));
          i++;
          if (onProgress) onProgress(i / chunks.length);
        } while (i < chunks.length && performance.now() - t0 < 12);
        if (i < chunks.length) (root.requestAnimationFrame || setTimeout)(step, 0);
        else resolve(meshes);
      }
      step();
    });
  }

  /* ---- worker path -------------------------------------------------------------------
     Surface nets on a 450k-point scene costs 150-200ms per chunk, and a chunk cannot be cut
     in half part-way through — so slicing it across frames on the main thread still hitches
     by a whole chunk. The same code runs unchanged in a Worker instead: the page keeps its
     frame budget, and each finished chunk comes back as plain arrays for the main thread to
     wrap in a BufferGeometry, which is cheap.                                             */

  var IS_WORKER = typeof importScripts === 'function' && typeof document === 'undefined';

  if (IS_WORKER) {
    root.onmessage = function (e) {
      var d = e.data;
      try {
        var st = setup({ pts: d.pts, nrm: d.nrm, count: d.count, spacing: d.spacing, config: d.config });
        if (!st) { root.postMessage({ done: true, chunks: 0 }); return; }
        var chunks = chunkBounds(st.ix, st.cfg, st.pad);
        for (var i = 0; i < chunks.length; i++) {
          var b = chunks[i], res = chunkRes(b, st.voxel, st.cfg.maxRes);
          var out = surfaceNets(st.field, b, res[0], res[1], res[2], st.cfg.isoLevel, st.cfg.minVertsPerChunk);
          if (!out) continue;
          if (st.cfg.smoothIters) smooth(out.positions, out.indices, st.cfg.smoothIters, st.cfg.smoothAmount);
          var pos = new Float32Array(out.positions);
          var idx = (out.positions.length / 3 > 65535 ? new Uint32Array(out.indices) : new Uint16Array(out.indices));
          root.postMessage(
            { chunk: true, name: 'meshified_' + b[6] + '_' + b[7] + '_' + b[8], positions: pos, indices: idx, i: i, total: chunks.length },
            [pos.buffer, idx.buffer]
          );
        }
        root.postMessage({ done: true, chunks: chunks.length });
      } catch (err) {
        root.postMessage({ error: String(err && err.message || err) });
      }
    };
  }

  // remembered at load so callers do not have to know where this file lives
  var SELF_URL = (!IS_WORKER && typeof document !== 'undefined' && document.currentScript)
    ? document.currentScript.src : null;

  /* meshifySceneWorker(opts) -> Promise<[THREE.Mesh]>, with the heavy maths off the main
     thread. Falls back to the in-page async path when Workers are unavailable.           */
  function meshifySceneWorker(opts) {
    var THREE = opts.THREE || root.THREE;
    var url = opts.workerUrl || SELF_URL;
    if (typeof Worker === 'undefined' || !url) return meshifySceneAsync(opts);

    return new Promise(function (resolve) {
      var worker;
      try { worker = new Worker(url); }
      catch (e) { resolve(meshifySceneAsync(opts)); return; }

      var material = opts.material || new THREE.MeshStandardMaterial({ color: 0xb9c4d4, roughness: 0.82, metalness: 0.0 });
      var meshes = [], settled = false;
      function finish() {
        if (settled) return;
        settled = true;
        worker.terminate();
        resolve(meshes);
      }
      worker.onerror = function () { finish(); };
      worker.onmessage = function (e) {
        var d = e.data;
        if (d.error) { console.warn('meshify worker:', d.error); finish(); return; }
        if (d.done) { finish(); return; }
        if (!d.chunk) return;
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
        g.setIndex(new THREE.BufferAttribute(d.indices, 1));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        g.computeBoundingBox();
        var m = new THREE.Mesh(g, material);
        m.name = d.name;
        m.userData.reconstructed = true;
        meshes.push(m);
        if (opts.onProgress) opts.onProgress((d.i + 1) / d.total);
      };

      // the engine still owns pts/nrm, so send copies rather than transferring the buffers
      var count = opts.count || (opts.pts.length / 4);
      var pts = opts.pts.slice(0, count * 4), nrm = opts.nrm.slice(0, count);
      worker.postMessage(
        { pts: pts, nrm: nrm, count: count, spacing: opts.spacing, config: opts.config || {} },
        [pts.buffer, nrm.buffer]
      );
    });
  }

  root.Meshify = {
    meshifyScene: meshifyScene,
    meshifySceneAsync: meshifySceneAsync,
    meshifySceneWorker: meshifySceneWorker,
    unpackN: unpackN,
    CONFIG: CFG
  };
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
