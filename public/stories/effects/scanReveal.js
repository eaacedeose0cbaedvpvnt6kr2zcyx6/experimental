/* scanReveal.js — scan-reveal hover effect.

   Every target is drawn as a point cloud. Where the pointer rests on an object, a soft
   circular area reveals the real mesh underneath with its own materials; when the pointer
   leaves, the area closes back into points over a few seconds.

       const scan = createScanReveal({ renderer, scene, camera, targets, options });
       scan.update(dt);            // once a frame, from the existing render loop
       scan.setEnabled(bool);
       scan.dispose();

   Call it AFTER models finish loading. `targets` defaults to every visible mesh in the scene.

   This project ships Three.js r128 as a UMD global and has no build step, so the module
   attaches itself to window rather than using ES module syntax. CommonJS is also honoured
   for tooling.                                                                             */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.createScanReveal = api.createScanReveal;
  root.ScanReveal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ============================== CONFIG ==============================
     Everything tweakable lives here. Pass any subset as `options`.      */
  var DEFAULTS = {
    // --- point cloud ---
    // false when the host already draws the cloud itself (the story engine does); the brush,
    // the mesh patching and the particles still work, and no second cloud is built
    pointCloud: true,
    pointCount: 500000,        // desktop budget
    pointCountMobile: 200000,  // touch-device budget
    pointSize: 2.4,            // px at 1 unit from camera, before pixel-ratio scaling
    pointColor: 0xdcdcdc,      // neutral white
    pointOpacity: 0.92,
    hotPixelFraction: 0.006,   // slightly bigger / brighter points
    outlierFraction: 0.03,     // pushed off the surface along the normal (scanner noise)
    outlierOffset: 0.015,      // as a fraction of scene size
    breathAmplitude: 0.0035,   // world units, along the normal
    distanceFade: 1.0,         // 1 = default falloff; raise to fade sooner
    largeSurfaceDensity: 0.4,  // walls / floors / big planes
    smallObjectDensity: 1.5,   // small detailed objects

    // --- reveal brush ---
    brushRadius: 0.22,         // fraction of the scene bounding-box size
    brushScreenFraction: 0.16, // and never smaller than this share of the distance to the hit
    planeFallback: true,       // brush follows the pointer even between pieces of geometry
    trailLength: 28,           // ring-buffer slots (must match the shader #define)
    rampSpeed: 4.0,            // head strength gain per second
    fadeSpeed: 0.28,           // trail decay per second (~3.5 s to fully close)
    trailStepFraction: 0.02,   // push a new trail point after moving this much of scene size
    revealLift: 0.06,          // how far revealed points lift, as a fraction of scene size
    revealSwirl: 0.5,
    edgeWidth: 0.12,           // reveal-edge glow width in `dd` units
    noiseScale: 1.6,           // organic edge frequency, relative to scene size
    rimColor: 0x22c07a,        // royal green rim on the opening edge
    // true: the opening shows an x-ray film of the geometry instead of its own material.
    // false: the original materials are kept and patched, and simply un-discarded inside.
    xray: true,
    // the spec values were tuned against black; over a bright cloud the film needs more body
    xrayFilmBase: 0.085,
    xrayFilmEdge: 0.20,
    xrayFresnel: 0.80,
    xrayFresnelPow: 3.4,
    // the camera path runs through the modelled geometry on some shots; fading the film out
    // near the lens stops a pier or a wall from filling the frame as the camera passes it
    xrayNearFade: 0.075,      // fraction of the scene size
    // how strongly the modelled geometry reads when the pointer is nowhere near it. 0 would put
    // it back to being invisible until hovered, which is not what the scenes need.
    // Making the geometry the primary layer needs an OPAQUE lit pass that writes depth and
    // occludes. This material is additive and double-sided, so at rest every surface stacked
    // into a white wash instead of reading as solid. Hover-only until that pass exists.
    xrayRest: 0.0,
    // the solid pass: a warm stone the night light picks out, rather than a cold slab
    solidLo: 0x24262b,      // the dark rock the crystals sit on
    solidHi: 0x6b7079,      // dark grey, cooled to match the reference
    solidFog: 1.15,
    solidOpacity: 0.26,      // additive gain: the form reads without washing the cloud out
    solidNearFade: 0.55,     // wider than the film: solid geometry blocks far more of the frame

    // --- scan web ---
    webDensity: 60000,         // points considered for neighbour linking
    webRadius: 0.012,          // link radius as a fraction of scene size
    webOpacity: 0.055,
    strayLines: 400,
    strayOpacity: 0.03,

    // --- dust ---
    dustCount: 2500,
    dustOpacity: 0.35,

    // --- lidar sweep ---
    sweepEnabled: true,
    sweepSpeed: 0.12,          // scene heights per second
    sweepWidth: 0.05,          // as a fraction of scene height
    sweepGain: 1.8,

    // --- particles ---
    particleCount: 5000,
    emitRate: 140,             // per second while hovering
    emitRateMax: 1400,         // cap including the speed-proportional term
    emitBurst: 140,            // on first entering an object
    particleLifeMin: 0.6,
    particleLifeMax: 1.8,
    particleSize: 3.2,

    // --- post ---
    post: true,
    bloomStrength: 0.62,
    bloomRadius: 0.5,
    bloomThreshold: 0.5,
    grainAmount: 0.035,
    vignetteAmount: 0.35,

    // --- misc ---
    maxPixelRatio: 1.6,
    lightDirection: [-0.45, 0.72, 0.53],
    respectReducedMotion: true,
    loadingDelay: 200,         // ms before a loading state is worth showing
    onLoadingStart: null,
    onLoadingEnd: null
  };

  var TRAIL_MAX = 28;

  // ============================== GLSL ==============================

  /* The reveal field. Identical source is compiled into the points, the scan web and every
     patched mesh material, so all three agree on exactly where the surface is open.       */
  var REVEAL_GLSL = [
    'uniform vec4 uTrail[TRAIL_LEN];',
    'uniform float uBrushR;',
    'uniform float uNoiseScale;',
    'uniform float uRevealAll;',
    'float sr_hash31(vec3 p){',
    '  p = fract(p * 0.1031);',
    '  p += dot(p, p.yzx + 33.33);',
    '  return fract((p.x + p.y) * p.z);',
    '}',
    'float sr_vnoise(vec3 p){',
    '  vec3 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float n000 = sr_hash31(i);',
    '  float n100 = sr_hash31(i + vec3(1.0, 0.0, 0.0));',
    '  float n010 = sr_hash31(i + vec3(0.0, 1.0, 0.0));',
    '  float n110 = sr_hash31(i + vec3(1.0, 1.0, 0.0));',
    '  float n001 = sr_hash31(i + vec3(0.0, 0.0, 1.0));',
    '  float n101 = sr_hash31(i + vec3(1.0, 0.0, 1.0));',
    '  float n011 = sr_hash31(i + vec3(0.0, 1.0, 1.0));',
    '  float n111 = sr_hash31(i + vec3(1.0, 1.0, 1.0));',
    '  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),',
    '             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);',
    '}',
    // two octaves is enough to break the circle without looking noisy
    'float sr_fbm(vec3 p){ return sr_vnoise(p) * 0.65 + sr_vnoise(p * 2.07) * 0.35; }',
    'float reveal(vec3 p){',
    '  if (uRevealAll > 0.5) return 1.0;',
    '  if (uTrailBound.w <= 0.0) return 0.0;',
    '  if (distance(p, uTrailBound.xyz) > uTrailBound.w) return 0.0;',
    '  float r = 0.0;',
    '  float nz = sr_fbm(p * uNoiseScale) - 0.5;',
    '  for (int i = 0; i < TRAIL_LEN; i++) {',
    '    vec4 t = uTrail[i];',
    '    if (t.w <= 0.0) continue;',
    '    float rad = uBrushR * (0.4 + 0.6 * t.w);',
    '    float d = distance(p, t.xyz) + nz * rad * 0.85;',
    '    r = max(r, (1.0 - smoothstep(rad * 0.3, rad, d)) * t.w);',
    '  }',
    '  return r;',
    '}'
  ].join('\n');

  var POINTS_VERT = [
    'attribute vec3 aNormal;',
    'attribute float aRandom;',
    'attribute float aFlags;',      // 1 = hot pixel, 2 = outlier
    'uniform float uTime, uPixelRatio, uViewH, uPointSize, uSceneSize;',
    'uniform float uBreath, uLift, uSwirl, uEdgeWidth, uOutlier, uReduced;',
    'uniform float uSweepY, uSweepWidth, uSweepGain, uSweepOn;',
    'uniform vec3 uLightDir;',
    'varying float vShade, vEdge, vAlpha, vHot, vSweep, vDepth;',
    REVEAL_GLSL,
    'void main(){',
    '  vec3 n = normalize(aNormal);',
    '  vec3 p = position;',
    '  float hot = step(0.5, mod(aFlags, 2.0));',
    '  float outlier = step(0.5, mod(floor(aFlags * 0.5), 2.0));',
    '  p += n * outlier * uOutlier;',
    '  if (uReduced < 0.5) p += n * sin(uTime + aRandom * 6.2831853) * uBreath;',
    '  float dd = reveal(p) - 0.5;',
    // inside the reveal: lift off the surface with a little swirl, and fade out
    '  float lift = smoothstep(0.0, 0.3, dd);',
    '  if (lift > 0.0) {',
    '    vec3 tangent = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + vec3(0.001, 0.0, 0.0));',
    '    float a = uTime * 1.3 + aRandom * 6.2831853;',
    '    p += n * lift * uLift;',
    '    p += (tangent * cos(a) + cross(n, tangent) * sin(a)) * lift * uLift * uSwirl;',
    '  }',
    '  vAlpha = 1.0 - lift;',
    // a bright ring right at the edge of the reveal
    '  vEdge = 1.0 - smoothstep(0.0, uEdgeWidth, abs(dd));',
    '  vShade = 0.32 + 0.78 * abs(dot(n, uLightDir));',
    '  vHot = hot;',
    '  float sweep = 0.0;',
    '  if (uSweepOn > 0.5) sweep = 1.0 - smoothstep(0.0, uSweepWidth, abs(p.y - uSweepY));',
    '  vSweep = sweep * uSweepGain;',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  vDepth = -mv.z;',
    '  float size = uPointSize * (1.0 + hot * 1.6 + vEdge * 1.4 + vSweep * 0.5);',
    '  gl_PointSize = size * uPixelRatio * uViewH * 0.001 / max(0.05, -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var POINTS_FRAG = [
    'precision highp float;',
    'uniform vec3 uColor;',
    'uniform float uOpacity, uFadeNear, uFadeFar;',
    'varying float vShade, vEdge, vAlpha, vHot, vSweep, vDepth;',
    'void main(){',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float d = dot(uv, uv);',
    '  if (d > 0.25) discard;',
    '  float sprite = 1.0 - smoothstep(0.0, 0.25, d);',   // soft round sprite
    '  sprite *= sprite;',
    '  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, vDepth);',
    '  vec3 col = uColor * (vShade + vHot * 0.45 + vSweep * 0.6);',
    '  col += vec3(0.86, 0.86, 0.86) * vEdge * 1.5;',      // edge ring reads cooler and hotter
    '  float a = uOpacity * sprite * fade * vAlpha * (1.0 + vHot * 0.8 + vEdge * 1.2);',
    '  if (a <= 0.002) discard;',
    '  gl_FragColor = vec4(col * a, a);',
    '}'
  ].join('\n');

  var LINES_VERT = [
    'attribute float aRandom;',
    'uniform float uTime, uSceneSize, uEdgeWidth;',
    'varying float vAlpha, vEdge, vDepth;',
    REVEAL_GLSL,
    'void main(){',
    '  vec3 p = position;',
    '  float dd = reveal(p) - 0.5;',
    '  vAlpha = 1.0 - smoothstep(-0.02, 0.06, dd);',      // hidden inside the reveal
    '  vEdge = 1.0 - smoothstep(0.0, uEdgeWidth, abs(dd));',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  vDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var LINES_FRAG = [
    'precision highp float;',
    'uniform vec3 uColor;',
    'uniform float uOpacity, uFadeNear, uFadeFar;',
    'varying float vAlpha, vEdge, vDepth;',
    'void main(){',
    '  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, vDepth);',
    '  float a = uOpacity * vAlpha * fade * (1.0 + vEdge * 6.0);',
    '  if (a <= 0.001) discard;',
    '  vec3 col = uColor + vec3(0.72, 0.72, 0.72) * vEdge;',
    '  gl_FragColor = vec4(col * a, a);',
    '}'
  ].join('\n');

  var PARTICLE_VERT = [
    'attribute float aLife;',    // 1 -> 0 over the particle's life
    'attribute float aSeed;',
    'uniform float uPixelRatio, uViewH, uSize, uTime;',
    'varying float vLife, vSeed;',
    'void main(){',
    '  vLife = aLife; vSeed = aSeed;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  float tw = 0.75 + 0.25 * sin(uTime * 9.0 + aSeed * 6.2831853);',
    '  gl_PointSize = uSize * uPixelRatio * uViewH * 0.001 * (0.35 + aLife) * tw / max(0.05, -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var PARTICLE_FRAG = [
    'precision highp float;',
    'uniform vec3 uColor;',
    'uniform float uTime;',
    'varying float vLife, vSeed;',
    'void main(){',
    '  if (vLife <= 0.0) discard;',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float d = length(uv);',
    '  float core = 1.0 - smoothstep(0.0, 0.5, d);',
    '  core *= core;',
    // a tiny 4-point glint through the centre
    '  float glint = max(0.0, 1.0 - abs(uv.x) * 14.0) + max(0.0, 1.0 - abs(uv.y) * 14.0);',
    '  glint *= max(0.0, 1.0 - d * 2.2) * 0.5;',
    '  float tw = 0.7 + 0.3 * sin(uTime * 11.0 + vSeed * 12.566);',
    '  float a = (core + glint) * vLife * tw;',
    '  if (a <= 0.002) discard;',
    '  gl_FragColor = vec4(uColor * a, a);',
    '}'
  ].join('\n');

  // ============================== helpers ==============================

  function isTouchDevice() {
    return (typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  }

  function prefersReducedMotion() {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function collectTargets(scene) {
    var out = [];
    scene.traverse(function (o) {
      if (!o.visible || !o.isMesh) return;
      if (o.userData && o.userData.scanReveal === false) return;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      out.push(o);
    });
    return out;
  }

  /* Area-weighted triangle sampling in world space. Handles indexed and non-indexed
     geometry, and InstancedMesh by folding instanceMatrix into the world transform.      */
  function triangleAreas(geo) {
    var pos = geo.attributes.position, idx = geo.index;
    var triCount = idx ? idx.count / 3 : pos.count / 3;
    var areas = new Float64Array(triCount);
    var total = 0;
    for (var t = 0; t < triCount; t++) {
      var a, b, c;
      if (idx) { a = idx.getX(t * 3); b = idx.getX(t * 3 + 1); c = idx.getX(t * 3 + 2); }
      else { a = t * 3; b = t * 3 + 1; c = t * 3 + 2; }
      var ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
      var bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
      var cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
      var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      var area = 0.5 * Math.hypot(nx, ny, nz);
      areas[t] = area; total += area;
    }
    // prefix sums for O(log n) weighted picks
    var cum = new Float64Array(triCount);
    var run = 0;
    for (var i = 0; i < triCount; i++) { run += areas[i]; cum[i] = run; }
    return { cum: cum, total: total, triCount: triCount };
  }

  function pickTriangle(cum, triCount, r) {
    var lo = 0, hi = triCount - 1;
    var target = r * cum[triCount - 1];
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // ============================== main ==============================

  function createScanReveal(args) {
    var THREE = args.THREE || (typeof window !== 'undefined' ? window.THREE : null);
    if (!THREE) throw new Error('scanReveal: THREE not found');

    var renderer = args.renderer, scene = args.scene, camera = args.camera;
    if (!renderer || !scene || !camera) throw new Error('scanReveal: renderer, scene and camera are required');

    var cfg = Object.assign({}, DEFAULTS, args.options || {});
    var touch = isTouchDevice();
    var reduced = cfg.respectReducedMotion && prefersReducedMotion();
    var wantCloud = cfg.pointCloud !== false;
    var budget = wantCloud ? (touch ? cfg.pointCountMobile : cfg.pointCount) : 64;

    var targets = (args.targets && args.targets.length ? args.targets : collectTargets(scene))
      .filter(function (m) { return m.isMesh; });
    if (!targets.length) {
      console.warn('scanReveal: no target meshes found; effect is inert');
    }

    // cap pixel ratio as specced, remembering what it was so dispose() can restore it
    var prevPixelRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(Math.min(prevPixelRatio, cfg.maxPixelRatio));

    var loadingTimer = null, loadingShown = false;
    if (cfg.onLoadingStart) {
      loadingTimer = setTimeout(function () { loadingShown = true; cfg.onLoadingStart(); }, cfg.loadingDelay);
    }

    // ---------- scene extent ----------
    var bbox = new THREE.Box3();
    var _im = new THREE.Matrix4(), _ib = new THREE.Box3();
    for (var ti = 0; ti < targets.length; ti++) {
      var tgt = targets[ti];
      tgt.updateWorldMatrix(true, false);
      if (tgt.isInstancedMesh) {
        if (!tgt.geometry.boundingBox) tgt.geometry.computeBoundingBox();
        for (var ii = 0; ii < tgt.count; ii++) {
          tgt.getMatrixAt(ii, _im);
          _im.premultiply(tgt.matrixWorld);
          _ib.copy(tgt.geometry.boundingBox).applyMatrix4(_im);
          bbox.union(_ib);
        }
      } else {
        var tb = new THREE.Box3().setFromObject(tgt);
        if (!tb.isEmpty()) bbox.union(tb);
      }
    }
    if (bbox.isEmpty()) bbox.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    var sceneSizeV = bbox.getSize(new THREE.Vector3());
    var sceneSize = Math.max(sceneSizeV.x, sceneSizeV.y, sceneSizeV.z) || 1;
    var sceneCenter = bbox.getCenter(new THREE.Vector3());
    var brushR = cfg.brushRadius * sceneSize;
    var trailStep = cfg.trailStepFraction * sceneSize;

    // ---------- per-target density weights ----------
    var perTarget = [], totalWeighted = 0, skinnedSkipped = 0;
    for (var i = 0; i < targets.length; i++) {
      var mesh = targets[i];
      // SkinnedMesh: we sample the BIND POSE (geometry as authored). Skinning happens on the
      // GPU, so CPU-side sampled points would not follow the animation; the bind pose keeps
      // the cloud stable and still matches the mesh for any non-animated rig.
      if (mesh.isSkinnedMesh) skinnedSkipped++;
      var geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      var ta = triangleAreas(geo);
      if (!ta.total || !isFinite(ta.total)) continue;

      var instCount = mesh.isInstancedMesh ? mesh.count : 1;
      // world-space area scales with the transform, so weight by it
      var sc = mesh.getWorldScale(new THREE.Vector3());
      var scaleArea = Math.max(1e-6, (Math.abs(sc.x * sc.y) + Math.abs(sc.y * sc.z) + Math.abs(sc.x * sc.z)) / 3);
      var worldArea = ta.total * scaleArea * instCount;

      var gs = geo.boundingBox.getSize(new THREE.Vector3());
      var diag = gs.length() * Math.max(Math.abs(sc.x), Math.abs(sc.y), Math.abs(sc.z));
      var rel = diag / sceneSize;

      // walls / floors / big planes read as low-poly and large -> thin them out;
      // small detailed props -> densify so they stay readable
      var density = 1.0;
      if (rel > 0.45 && ta.triCount < 400) density = cfg.largeSurfaceDensity;
      else if (rel > 0.6) density = cfg.largeSurfaceDensity;
      else if (rel < 0.12) density = cfg.smallObjectDensity;
      if (mesh.userData && typeof mesh.userData.scanDensity === 'number') density = mesh.userData.scanDensity;

      var weighted = worldArea * density;
      perTarget.push({ mesh: mesh, ta: ta, weighted: weighted, instCount: instCount });
      totalWeighted += weighted;
    }

    // ---------- sample the cloud (sorted by object: we fill target by target) ----------
    var counts = [], allocated = 0;
    for (i = 0; i < perTarget.length; i++) {
      var n = Math.max(1, Math.floor(budget * perTarget[i].weighted / (totalWeighted || 1)));
      counts.push(n); allocated += n;
    }
    var pointTotal = Math.min(allocated, budget);

    var pPos = new Float32Array(pointTotal * 3);
    var pNrm = new Float32Array(pointTotal * 3);
    var pRnd = new Float32Array(pointTotal);
    var pFlag = new Float32Array(pointTotal);
    var pObj = new Int32Array(pointTotal);   // object id, for same-object web linking

    var mat4 = new THREE.Matrix4(), mat3 = new THREE.Matrix3();
    var vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    var vN = new THREE.Vector3(), vP = new THREE.Vector3();
    var cursor = 0;

    for (i = 0; i < perTarget.length && cursor < pointTotal; i++) {
      var entry = perTarget[i];
      var m = entry.mesh, g = m.geometry, cum = entry.ta.cum, tri = entry.ta.triCount;
      var posAttr = g.attributes.position, idxAttr = g.index;
      var want = Math.min(counts[i], pointTotal - cursor);

      m.updateWorldMatrix(true, false);
      for (var s = 0; s < want; s++) {
        // InstancedMesh: fold the per-instance matrix into the world transform
        if (m.isInstancedMesh) {
          var inst = Math.floor(Math.random() * entry.instCount);
          m.getMatrixAt(inst, mat4);
          mat4.premultiply(m.matrixWorld);
        } else {
          mat4.copy(m.matrixWorld);
        }
        mat3.getNormalMatrix(mat4);

        var t = pickTriangle(cum, tri, Math.random());
        var ia, ib, ic;
        if (idxAttr) { ia = idxAttr.getX(t * 3); ib = idxAttr.getX(t * 3 + 1); ic = idxAttr.getX(t * 3 + 2); }
        else { ia = t * 3; ib = t * 3 + 1; ic = t * 3 + 2; }
        vA.fromBufferAttribute(posAttr, ia);
        vB.fromBufferAttribute(posAttr, ib);
        vC.fromBufferAttribute(posAttr, ic);

        // uniform barycentric sample
        var r1 = Math.random(), r2 = Math.random();
        if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
        vP.copy(vA)
          .addScaledVector(vB.clone().sub(vA), r1)
          .addScaledVector(vC.clone().sub(vA), r2);

        // face normal from the triangle itself
        vN.copy(vB).sub(vA).cross(vC.clone().sub(vA)).normalize();

        vP.applyMatrix4(mat4);
        vN.applyMatrix3(mat3).normalize();

        var o = cursor * 3;
        pPos[o] = vP.x; pPos[o + 1] = vP.y; pPos[o + 2] = vP.z;
        pNrm[o] = vN.x; pNrm[o + 1] = vN.y; pNrm[o + 2] = vN.z;
        pRnd[cursor] = Math.random();
        var flags = 0;
        if (Math.random() < cfg.hotPixelFraction) flags |= 1;
        if (Math.random() < cfg.outlierFraction) flags |= 2;
        pFlag[cursor] = flags;
        pObj[cursor] = i;
        cursor++;
      }
    }
    pointTotal = cursor;

    // ---------- points object ----------
    var ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(pPos.subarray(0, pointTotal * 3), 3));
    ptGeo.setAttribute('aNormal', new THREE.BufferAttribute(pNrm.subarray(0, pointTotal * 3), 3));
    ptGeo.setAttribute('aRandom', new THREE.BufferAttribute(pRnd.subarray(0, pointTotal), 1));
    ptGeo.setAttribute('aFlags', new THREE.BufferAttribute(pFlag.subarray(0, pointTotal), 1));

    var lightDir = new THREE.Vector3().fromArray(cfg.lightDirection).normalize();
    var camDist = sceneSize * 2.2;

    // uniforms shared BY REFERENCE across the points, the web and every patched material
    var shared = {
      uTrail: { value: (function () { var a = []; for (var k = 0; k < TRAIL_MAX; k++) a.push(new THREE.Vector4(0, 0, 0, 0)); return a; })() },
      uBrushR: { value: brushR },
      uNoiseScale: { value: cfg.noiseScale / sceneSize },
      uRevealAll: { value: 0 },
      uTrailBound: { value: new THREE.Vector4(0, 0, 0, 0) }
    };

    var ptUniforms = Object.assign({
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uViewH: { value: renderer.domElement.clientHeight || 800 },
      uPointSize: { value: cfg.pointSize },
      uSceneSize: { value: sceneSize },
      uBreath: { value: reduced ? 0 : cfg.breathAmplitude },
      uLift: { value: cfg.revealLift * sceneSize },
      uSwirl: { value: cfg.revealSwirl },
      uEdgeWidth: { value: cfg.edgeWidth },
      uOutlier: { value: cfg.outlierOffset * sceneSize },
      uReduced: { value: reduced ? 1 : 0 },
      uSweepY: { value: bbox.min.y },
      uSweepWidth: { value: cfg.sweepWidth * sceneSizeV.y },
      uSweepGain: { value: cfg.sweepGain },
      uSweepOn: { value: (cfg.sweepEnabled && !reduced) ? 1 : 0 },
      uLightDir: { value: lightDir },
      uColor: { value: new THREE.Color(cfg.pointColor) },
      uOpacity: { value: cfg.pointOpacity },
      uFadeNear: { value: camDist * cfg.distanceFade },
      uFadeFar: { value: camDist * 3.2 * cfg.distanceFade }
    }, shared);

    var ptMat = new THREE.ShaderMaterial({
      uniforms: ptUniforms,
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      defines: { TRAIL_LEN: TRAIL_MAX },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });

    var points = new THREE.Points(ptGeo, ptMat);
    points.frustumCulled = false;
    points.renderOrder = 2;
    if (wantCloud) scene.add(points); else points.visible = false;

    // ---------- scan web: 2 nearest neighbours, same object only ----------
    var webGeo = null, webLines = null, webMat = null;
    (function buildWeb() {
      if (!wantCloud || !cfg.webDensity || pointTotal < 8) return;
      var sub = Math.min(cfg.webDensity, pointTotal);
      var stride = Math.max(1, Math.floor(pointTotal / sub));
      var idxs = [];
      for (var k = 0; k < pointTotal; k += stride) idxs.push(k);
      var count = idxs.length;
      var radius = cfg.webRadius * sceneSize, r2 = radius * radius;

      // spatial hash over the subset
      var cell = radius;
      var TBL = 1 << 16, mask = TBL - 1;
      var cnt = new Uint32Array(TBL + 1), key = new Uint32Array(count);
      function hash(x, y, z) {
        return ((((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) & mask);
      }
      for (k = 0; k < count; k++) {
        var p3 = idxs[k] * 3;
        var h = hash(Math.floor(pPos[p3] / cell), Math.floor(pPos[p3 + 1] / cell), Math.floor(pPos[p3 + 2] / cell));
        key[k] = h; cnt[h + 1]++;
      }
      for (k = 0; k < TBL; k++) cnt[k + 1] += cnt[k];
      var fill = cnt.slice(0, TBL), order = new Uint32Array(count);
      for (k = 0; k < count; k++) order[fill[key[k]]++] = k;

      var segs = [];
      for (k = 0; k < count; k++) {
        var si = idxs[k], sp = si * 3;
        var x = pPos[sp], y = pPos[sp + 1], z = pPos[sp + 2], obj = pObj[si];
        var gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
        // keep the two closest same-object neighbours
        var b1 = -1, d1 = Infinity, b2 = -1, d2 = Infinity;
        for (var dz = -1; dz <= 1; dz++)
          for (var dy = -1; dy <= 1; dy++)
            for (var dx = -1; dx <= 1; dx++) {
              var hh = hash(gx + dx, gy + dy, gz + dz);
              for (var q = cnt[hh]; q < cnt[hh + 1]; q++) {
                var oi = order[q]; if (oi === k) continue;
                var pj = idxs[oi];
                if (pObj[pj] !== obj) continue;            // never link across objects
                var jp = pj * 3;
                var ex = pPos[jp] - x, ey = pPos[jp + 1] - y, ez = pPos[jp + 2] - z;
                var dd2 = ex * ex + ey * ey + ez * ez;
                if (dd2 > r2) continue;
                if (dd2 < d1) { d2 = d1; b2 = b1; d1 = dd2; b1 = pj; }
                else if (dd2 < d2) { d2 = dd2; b2 = pj; }
              }
            }
        if (b1 >= 0) segs.push(x, y, z, pPos[b1 * 3], pPos[b1 * 3 + 1], pPos[b1 * 3 + 2]);
        if (b2 >= 0) segs.push(x, y, z, pPos[b2 * 3], pPos[b2 * 3 + 1], pPos[b2 * 3 + 2]);
      }

      // long, thin, mostly axis-aligned stray streaks
      var strayStart = segs.length / 6;
      for (k = 0; k < cfg.strayLines; k++) {
        var base = Math.floor(Math.random() * pointTotal) * 3;
        var len = sceneSize * (0.08 + Math.random() * 0.3);
        var ax = Math.floor(Math.random() * 3);
        var dirx = ax === 0 ? 1 : 0, diry = ax === 1 ? 1 : 0, dirz = ax === 2 ? 1 : 0;
        // "mostly" axis aligned: a small random tilt off the axis
        dirx += (Math.random() - 0.5) * 0.22;
        diry += (Math.random() - 0.5) * 0.22;
        dirz += (Math.random() - 0.5) * 0.22;
        var dl = Math.hypot(dirx, diry, dirz) || 1;
        if (Math.random() < 0.5) len = -len;
        segs.push(pPos[base], pPos[base + 1], pPos[base + 2],
          pPos[base] + dirx / dl * len, pPos[base + 1] + diry / dl * len, pPos[base + 2] + dirz / dl * len);
      }

      if (!segs.length) return;
      var arr = new Float32Array(segs);
      var rnd = new Float32Array(arr.length / 3);
      for (k = 0; k < rnd.length; k++) rnd[k] = Math.random();
      webGeo = new THREE.BufferGeometry();
      webGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      webGeo.setAttribute('aRandom', new THREE.BufferAttribute(rnd, 1));

      webMat = new THREE.ShaderMaterial({
        uniforms: Object.assign({
          uTime: { value: 0 },
          uSceneSize: { value: sceneSize },
          uEdgeWidth: { value: cfg.edgeWidth },
          uColor: { value: new THREE.Color(cfg.pointColor) },
          uOpacity: { value: cfg.webOpacity },
          uFadeNear: { value: camDist * cfg.distanceFade },
          uFadeFar: { value: camDist * 3.2 * cfg.distanceFade }
        }, shared),
        vertexShader: LINES_VERT,
        fragmentShader: LINES_FRAG,
        defines: { TRAIL_LEN: TRAIL_MAX },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
      webLines = new THREE.LineSegments(webGeo, webMat);
      webLines.frustumCulled = false;
      webLines.renderOrder = 1;
      // the stray streaks sit in the same buffer but want a fainter alpha; a second draw
      // range would need a second object, so they share the web's alpha and are simply
      // drawn thinner by being fewer. Keep them distinguishable via a draw-range split:
      webLines.userData.strayStart = strayStart;
      scene.add(webLines);
    })();

    // separate, fainter object for the stray streaks so they can carry their own opacity
    var strayLines = null;
    if (webLines && cfg.strayOpacity !== cfg.webOpacity) {
      var total = webGeo.attributes.position.count / 2;
      var split = webLines.userData.strayStart;
      if (split > 0 && split < total) {
        // draw the web portion only; clone a view for the strays
        webLines.geometry.setDrawRange(0, split * 2);
        var strayGeo = new THREE.BufferGeometry();
        var full = webGeo.attributes.position.array;
        strayGeo.setAttribute('position', new THREE.BufferAttribute(full.subarray(split * 6), 3));
        var sr = new Float32Array((full.length - split * 6) / 3);
        for (var k2 = 0; k2 < sr.length; k2++) sr[k2] = Math.random();
        strayGeo.setAttribute('aRandom', new THREE.BufferAttribute(sr, 1));
        var strayMat = webMat.clone();
        strayMat.uniforms = Object.assign({}, webMat.uniforms, shared, { uOpacity: { value: cfg.strayOpacity } });
        strayLines = new THREE.LineSegments(strayGeo, strayMat);
        strayLines.frustumCulled = false;
        strayLines.renderOrder = 1;
        scene.add(strayLines);
      }
    }

    // ---------- dust ----------
    var dust = null, dustGeo = null, dustMat = null;
    if (wantCloud && cfg.dustCount > 0) {
      var dpos = new Float32Array(cfg.dustCount * 3);
      var dlife = new Float32Array(cfg.dustCount);
      var dseed = new Float32Array(cfg.dustCount);
      for (i = 0; i < cfg.dustCount; i++) {
        dpos[i * 3] = bbox.min.x + Math.random() * sceneSizeV.x;
        dpos[i * 3 + 1] = bbox.min.y + Math.random() * sceneSizeV.y;
        dpos[i * 3 + 2] = bbox.min.z + Math.random() * sceneSizeV.z;
        dlife[i] = 0.25 + Math.random() * 0.45;
        dseed[i] = Math.random();
      }
      dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3).setUsage(THREE.DynamicDrawUsage));
      dustGeo.setAttribute('aLife', new THREE.BufferAttribute(dlife, 1));
      dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dseed, 1));
      dustMat = new THREE.ShaderMaterial({
        uniforms: {
          uPixelRatio: { value: renderer.getPixelRatio() },
          uViewH: { value: renderer.domElement.clientHeight || 800 },
          uSize: { value: cfg.particleSize * 0.7 },
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(cfg.pointColor) }
        },
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
      dust = new THREE.Points(dustGeo, dustMat);
      dust.frustumCulled = false;
      dust.userData.basePos = dpos.slice();
      scene.add(dust);
    }

    // ---------- reveal particles (CPU pool) ----------
    var PC = cfg.particleCount;
    var qPos = new Float32Array(PC * 3);
    var qVel = new Float32Array(PC * 3);
    var qLife = new Float32Array(PC);
    var qMax = new Float32Array(PC);
    var qSeed = new Float32Array(PC);
    for (i = 0; i < PC; i++) { qSeed[i] = Math.random(); qLife[i] = 0; }
    var qHead = 0;

    var partGeo = new THREE.BufferGeometry();
    partGeo.setAttribute('position', new THREE.BufferAttribute(qPos, 3).setUsage(THREE.DynamicDrawUsage));
    partGeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(PC), 1).setUsage(THREE.DynamicDrawUsage));
    partGeo.setAttribute('aSeed', new THREE.BufferAttribute(qSeed, 1));
    var partMat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: renderer.getPixelRatio() },
        uViewH: { value: renderer.domElement.clientHeight || 800 },
        uSize: { value: cfg.particleSize },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xe6e6e6) }
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });
    var particles = new THREE.Points(partGeo, partMat);
    particles.frustumCulled = false;
    particles.renderOrder = 3;
    scene.add(particles);

    /* ---------- patch the target materials ----------
       Materials and textures are kept; onBeforeCompile injects the shared reveal field so
       fragments outside the brush are discarded and the brush edge gets a bright rim.     */
    var patched = [];
    var rimColorV = new THREE.Color(cfg.rimColor);
    shared.uRimColor = { value: rimColorV };

    function patchMaterial(mat) {
      if (!mat || mat.userData.__scanRevealPatched) return;
      mat.userData.__scanRevealPatched = true;
      var prevCompile = mat.onBeforeCompile;
      mat.onBeforeCompile = function (shader, rendererRef) {
        if (prevCompile) prevCompile.call(this, shader, rendererRef);
        shader.defines = shader.defines || {};
        shader.defines.TRAIL_LEN = TRAIL_MAX;
        // share the trail / radius / noise / rim uniforms BY REFERENCE
        shader.uniforms.uTrail = shared.uTrail;
        shader.uniforms.uBrushR = shared.uBrushR;
        shader.uniforms.uNoiseScale = shared.uNoiseScale;
        shader.uniforms.uRevealAll = shared.uRevealAll;
        shader.uniforms.uRimColor = shared.uRimColor;

        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vScanWorldPos;')
          .replace('#include <worldpos_vertex>',
            '#include <worldpos_vertex>\n' +
            '#if defined(USE_ENVMAP) || defined(DISTANCE) || defined(USE_SHADOWMAP) || defined(USE_TRANSMISSION)\n' +
            '  vScanWorldPos = worldPosition.xyz;\n' +
            '#else\n' +
            '  vec4 srWP = vec4(transformed, 1.0);\n' +
            '  #ifdef USE_INSTANCING\n    srWP = instanceMatrix * srWP;\n  #endif\n' +
            '  vScanWorldPos = (modelMatrix * srWP).xyz;\n' +
            '#endif');

        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vScanWorldPos;\nuniform vec3 uRimColor;\n' + REVEAL_GLSL)
          .replace('#include <clipping_planes_fragment>',
            '#include <clipping_planes_fragment>\n' +
            'float dd = reveal(vScanWorldPos) - 0.5;\n' +
            'if (dd < 0.0) discard;')
          .replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n' +
            'totalEmissiveRadiance += uRimColor * (1.0 - smoothstep(0.0, 0.05, dd)) * 1.2;');

        mat.userData.__scanShader = shader;
      };
      // a distinct cache key so patched and unpatched variants never share a program
      var prevKey = mat.customProgramCacheKey;
      mat.customProgramCacheKey = function () {
        return 'scanReveal_' + TRAIL_MAX + '_' + (prevKey ? prevKey.call(this) : '');
      };
      mat.needsUpdate = true;
      patched.push(mat);
    }

    /* ---------- x-ray mode ----------
       Instead of revealing the target's own material, the opening shows the geometry as a
       faint blue film with a fresnel edge, so the form reads as a scan rather than as a lit
       object. Additive and depth-write-free, so overlapping shells stack into the section
       view you get from an actual x-ray. The originals are kept for dispose().             */
    var XRAY_VERT = [
      'varying vec3 vWPos;',
      'varying vec3 vWNrm;',
      'void main(){',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWPos = wp.xyz;',
      '  vWNrm = normalize(mat3(modelMatrix) * normal);',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n');

    var XRAY_FRAG = [
      'precision highp float;',
      'uniform vec3 uRimColor;',
      'uniform float uFilmBase, uFilmEdge, uFres, uFresPow, uNearFade, uRest, uSceneFade;',
      'varying vec3 vWPos;',
      'varying vec3 vWNrm;',
      REVEAL_GLSL,
      'void main(){',
      '  float dd = reveal(vWPos) - 0.5;',
      '  float inside = smoothstep(-0.06, 0.02, dd);',
      '  if (uRest <= 0.002 && inside <= 0.002) discard;',
      '  float dcam = distance(cameraPosition, vWPos);',
      '  float nearFade = smoothstep(uNearFade * 0.25, uNearFade, dcam);',
      '  if (nearFade <= 0.002) discard;',
      '  vec3 viewDir = normalize(cameraPosition - vWPos);',
      '  float ndv = abs(dot(normalize(vWNrm), viewDir));',
      // a faint blue film that thickens at grazing angles, plus a fresnel rim on the silhouette
      '  float body = uFilmBase + uFilmEdge * (1.0 - ndv);',
      '  float fres = pow(1.0 - ndv, uFresPow) * uFres;',
      '  vec3 rest  = body * 1.9 * vec3(0.76, 0.78, 0.84) + fres * 1.15 * vec3(0.92, 0.94, 1.0);',
      '  vec3 xray  = body * vec3(0.05, 0.36, 0.22) * 2.0 + fres * vec3(0.16, 0.88, 0.52) * 1.4;',
      '  vec3 col   = mix(rest, xray, inside);',
      // the thin bright line where the opening itself ends
      '  col *= mix(uRest, 1.0, inside);',
      '  col += uRimColor * (1.0 - smoothstep(0.0, 0.05, abs(dd))) * 1.2 * inside;',
      '  if (uSceneFade <= 0.002) discard;',
      '  gl_FragColor = vec4(col * nearFade * uSceneFade, 1.0);',
      '}'
    ].join('\n');

    /* ---------- the solid pass ----------
       The x-ray film is additive and double-sided, which is right for a small opening and wrong
       for a whole building: left on, every surface stacks into a white wash. So the geometry
       gets a second, opaque pass that writes depth and occludes properly, and that pass cuts
       away exactly where the opening is, letting the film show through the hole it makes.   */
    var SOLID_VERT = [
      'varying vec3 vWPos;',
      'varying vec3 vWNrm;',
      'void main(){',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  #ifdef USE_INSTANCING',
      '    wp = modelMatrix * instanceMatrix * vec4(position, 1.0);',
      '  #endif',
      '  vWPos = wp.xyz;',
      '  vec3 n = normal;',
      '  #ifdef USE_INSTANCING',
      '    n = mat3(instanceMatrix) * n;',
      '  #endif',
      '  vWNrm = normalize(mat3(modelMatrix) * n);',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n');

    var SOLID_FRAG = [
      'precision highp float;',
      'uniform vec3 uKeyDir, uLo, uHi;',
      'uniform float uSolidAlpha;',
      'uniform float uSceneFade, uNearFade, uFogD;',
      'varying vec3 vWPos;',
      'varying vec3 vWNrm;',
      REVEAL_GLSL,
      'void main(){',
      // the opening cuts a hole in the solid surface so the film can be seen inside it
      '  float dd = reveal(vWPos) - 0.5;',
      // feather the cut instead of a hard edge, so the solid never ends on a straight line
      '  if (dd > 0.06) discard;',
      '  float cut = 1.0 - smoothstep(-0.04, 0.06, dd);',
      '  float dcam = distance(cameraPosition, vWPos);',
      '  float nearFade = smoothstep(uNearFade * 0.18, uNearFade, dcam);',
      '  float vis = uSceneFade * nearFade;',
      '  if (vis <= 0.004) discard;',
      // one fixed key light, matching the engine's own baked direction, so the model sits in
      // the same light as the cloud without needing lights in the scene
      '  vec3 n = normalize(vWNrm);',
      '  float lam = 0.46 + 0.54 * max(0.0, dot(n, uKeyDir));',
      '  float rim = pow(1.0 - abs(dot(n, normalize(cameraPosition - vWPos))), 2.6);',
      '  vec3 col = mix(uLo, uHi, lam) + uHi * rim * 0.22;',
      '  float fog = 1.0 - exp(-pow(dcam * uFogD, 2.0));',
      '  col = mix(col, uLo * 0.55, fog * 0.92);',
      '  gl_FragColor = vec4(col * uSolidAlpha * cut * vis, 1.0);',
      '}'
    ].join('\n');

    var solidMat = null, solidMeshes = [];

    var xrayMat = null, originalMats = [];
    if (cfg.xray !== false) {
      xrayMat = new THREE.ShaderMaterial({
        uniforms: Object.assign({ uRimColor: shared.uRimColor,
          uFilmBase: { value: cfg.xrayFilmBase }, uFilmEdge: { value: cfg.xrayFilmEdge },
          uFres: { value: cfg.xrayFresnel }, uFresPow: { value: cfg.xrayFresnelPow },
          uNearFade: { value: cfg.xrayNearFade * sceneSize },
          uRest: { value: cfg.xrayRest },
          uSceneFade: { value: 1 } }, shared),
        vertexShader: XRAY_VERT,
        fragmentShader: XRAY_FRAG,
        defines: { TRAIL_LEN: TRAIL_MAX },
        side: THREE.DoubleSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
      solidMat = new THREE.ShaderMaterial({
        uniforms: Object.assign({
          uKeyDir: { value: new THREE.Vector3(-0.45, 0.72, 0.53).normalize() },
          uLo: { value: new THREE.Color(cfg.solidLo) },
          uHi: { value: new THREE.Color(cfg.solidHi) },
          uSceneFade: { value: 1 },
          uNearFade: { value: cfg.solidNearFade * sceneSize },
          uFogD: { value: cfg.solidFog / Math.max(1, sceneSize) },
          uSolidAlpha: { value: cfg.solidOpacity }
        }, shared),
        vertexShader: SOLID_VERT,
        fragmentShader: SOLID_FRAG,
        defines: { TRAIL_LEN: TRAIL_MAX },
        side: THREE.FrontSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
      for (i = 0; i < targets.length; i++) {
        originalMats.push(targets[i].material);
        targets[i].material = xrayMat;
        // a twin carrying the same geometry, drawn opaque underneath the film
        var t = targets[i], twin;
        if (t.isInstancedMesh) {
          twin = new THREE.InstancedMesh(t.geometry, solidMat, t.count);
          twin.instanceMatrix.copy(t.instanceMatrix);
          twin.instanceMatrix.needsUpdate = true;
        } else {
          twin = new THREE.Mesh(t.geometry, solidMat);
        }
        twin.position.copy(t.position); twin.quaternion.copy(t.quaternion); twin.scale.copy(t.scale);
        twin.frustumCulled = false;
        twin.renderOrder = -1;          // solid first, so the film lands on top of it
        twin.name = t.name + '_solid';
        scene.add(twin);
        solidMeshes.push(twin);
      }
    } else {
      for (i = 0; i < targets.length; i++) {
        var mt = targets[i].material;
        if (Array.isArray(mt)) { for (var mi = 0; mi < mt.length; mi++) patchMaterial(mt[mi]); }
        else patchMaterial(mt);
      }
    }

    // ---------- pointer + trail ----------
    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2(0, 0);
    var pointerInside = false, pointerActive = !touch;  // on touch, only while dragging
    // hosts that recreate the effect as content swaps can hand over the live pointer state
    if (args.initialPointer) {
      pointer.set(args.initialPointer.x || 0, args.initialPointer.y || 0);
      pointerInside = !!args.initialPointer.inside;
      if (typeof args.initialPointer.active === 'boolean') pointerActive = args.initialPointer.active;
    }
    var trail = [];   // {pos: Vector3, w: number}
    for (i = 0; i < TRAIL_MAX; i++) trail.push({ pos: new THREE.Vector3(), w: 0 });
    var headIndex = 0, headActive = false;
    var lastHit = new THREE.Vector3(), lastHitValid = false;
    var hitNormal = new THREE.Vector3(0, 1, 0);
    var hitSpeed = 0, wasOver = false;
    var emitAccum = 0;

    var dom = renderer.domElement;

    function updatePointerFromEvent(e) {
      var rect = dom.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      pointerInside = e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
    }

    // passive listeners on the canvas only: existing controls and GSAP timelines are untouched
    function onPointerMove(e) {
      if (e.pointerType === 'touch' && !pointerActive) return;
      updatePointerFromEvent(e);
    }
    function onPointerDown(e) {
      if (e.pointerType === 'touch') { pointerActive = true; updatePointerFromEvent(e); }
    }
    function onPointerUp(e) {
      if (e.pointerType === 'touch') pointerActive = false;   // trail keeps fading on its own
    }
    function onPointerLeave() { pointerInside = false; }
    function onPointerEnter() { pointerInside = true; }

    // bound to window, not the canvas: pages commonly stack overlays above the canvas, and a
    // canvas-bound listener would then never fire. NDC still comes from the canvas rect.
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });

    // ---------- post-processing ----------
    var composer = args.composer || null, ownComposer = false, bloomPass = null, gradePass = null;
    if (cfg.post) {
      try {
        if (!composer && THREE.EffectComposer && THREE.RenderPass) {
          composer = new THREE.EffectComposer(renderer);
          composer.addPass(new THREE.RenderPass(scene, camera));
          ownComposer = true;
        }
        if (composer && THREE.UnrealBloomPass) {
          var sizeV = renderer.getSize(new THREE.Vector2());
          bloomPass = new THREE.UnrealBloomPass(sizeV, cfg.bloomStrength, cfg.bloomRadius, cfg.bloomThreshold);
          composer.addPass(bloomPass);
        }
        if (composer && THREE.ShaderPass) {
          // very light grain + soft vignette. No glitch, no chromatic aberration, no scanlines.
          gradePass = new THREE.ShaderPass({
            uniforms: {
              tDiffuse: { value: null },
              uTime: { value: 0 },
              uGrain: { value: cfg.grainAmount },
              uVignette: { value: cfg.vignetteAmount }
            },
            vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
            fragmentShader: [
              'uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette; varying vec2 vUv;',
              'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
              'void main(){',
              '  vec4 c = texture2D(tDiffuse, vUv);',
              '  float g = (h21(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5) * uGrain;',
              '  c.rgb += g;',
              '  vec2 d = vUv - 0.5;',
              '  c.rgb *= 1.0 - uVignette * dot(d, d) * 1.8;',
              '  gl_FragColor = c;',
              '}'
            ].join('\n')
          });
          gradePass.renderToScreen = true;
          composer.addPass(gradePass);
        }
      } catch (err) {
        console.warn('scanReveal: post-processing unavailable, continuing without it', err);
        composer = args.composer || null;
      }
    }

    if (loadingTimer) clearTimeout(loadingTimer);
    if (loadingShown && cfg.onLoadingEnd) cfg.onLoadingEnd();

    // ---------- runtime ----------
    var enabled = true, time = 0;
    var tmpV = new THREE.Vector3(), tmpN = new THREE.Vector3();
    var camDir = new THREE.Vector3();
    var hitNormalMat = new THREE.Matrix3();
    // scratch for the plane the brush falls back to when no surface is struck
    var fbPlane = new THREE.Plane(), fbNormal = new THREE.Vector3(), fbPoint = new THREE.Vector3();
    var lifeAttr = partGeo.attributes.aLife;

    function emitParticle(px, py, pz, nx, ny, nz, radius) {
      var i2 = qHead; qHead = (qHead + 1) % PC;
      // a ring around the hit point, 45-100% of the current radius
      var ang = Math.random() * Math.PI * 2;
      // orthonormal basis around the normal; reference axis chosen not to be parallel to it
      var ax = Math.abs(ny) < 0.9 ? 0 : 1, ay = Math.abs(ny) < 0.9 ? 1 : 0;
      var tx = ay * nz, ty = -ax * nz, tz = ax * ny - ay * nx;
      var tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      var bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var dirx = tx * ca + bx * sa, diry = ty * ca + by * sa, dirz = tz * ca + bz * sa;
      var rr = radius * (0.45 + Math.random() * 0.55);

      qPos[i2 * 3] = px + dirx * rr;
      qPos[i2 * 3 + 1] = py + diry * rr;
      qPos[i2 * 3 + 2] = pz + dirz * rr;

      var sN = (0.25 + Math.random() * 0.8) * sceneSize * 0.06;
      var sT = (0.15 + Math.random() * 0.5) * sceneSize * 0.06;
      qVel[i2 * 3] = nx * sN + dirx * sT + (Math.random() - 0.5) * sceneSize * 0.01;
      qVel[i2 * 3 + 1] = ny * sN + diry * sT + (Math.random() - 0.5) * sceneSize * 0.01 + sceneSize * 0.012;
      qVel[i2 * 3 + 2] = nz * sN + dirz * sT + (Math.random() - 0.5) * sceneSize * 0.01;

      qMax[i2] = cfg.particleLifeMin + Math.random() * (cfg.particleLifeMax - cfg.particleLifeMin);
      qLife[i2] = qMax[i2];
    }

    function update(dt) {
      var i;
      if (!enabled) return;
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.1) dt = 0.1;         // a tab-switch stall must not blow the simulation up
      time += dt;

      ptUniforms.uTime.value = time;
      if (webMat) webMat.uniforms.uTime.value = time;
      partMat.uniforms.uTime.value = time;
      if (dustMat) dustMat.uniforms.uTime.value = time;
      if (gradePass) gradePass.uniforms.uTime.value = time;

      // keep the pixel-ratio / viewport driven sizes honest across resizes
      var pr = renderer.getPixelRatio(), vh = dom.clientHeight || 800;
      ptUniforms.uPixelRatio.value = pr; ptUniforms.uViewH.value = vh;
      partMat.uniforms.uPixelRatio.value = pr; partMat.uniforms.uViewH.value = vh;
      if (dustMat) { dustMat.uniforms.uPixelRatio.value = pr; dustMat.uniforms.uViewH.value = vh; }

      // lidar sweep rises through the scene and wraps
      if (cfg.sweepEnabled && !reduced) {
        var span = sceneSizeV.y || 1;
        ptUniforms.uSweepY.value = bbox.min.y + ((time * cfg.sweepSpeed * span) % (span * 1.25));
      }

      /* --- raycast every frame: the camera may move while the pointer is still --- */
      var over = false;
      if (pointerInside && pointerActive && targets.length) {
        // update() runs before the host's render(), so the camera's world matrix may still be
        // a frame stale (or never computed at all, if the camera is not part of the graph)
        camera.updateMatrixWorld();
        raycaster.setFromCamera(pointer, camera);
        var hits = raycaster.intersectObjects(targets, false);
        /* Requiring a precise triangle hit made the reveal feel broken: the modelled geometry is
           a fraction of what the cloud draws, so the pointer is usually between pieces and the
           brush never lit at all. When nothing is struck, fall back to the point on a plane
           through the scene centre facing the camera — the brush then follows the pointer
           anywhere over the subject, and still snaps to real surfaces when it meets them. */
        if (!hits.length && cfg.planeFallback !== false) {
          fbNormal.copy(camera.position).sub(sceneCenter);
          var fbLen = fbNormal.length();
          if (fbLen > 1e-4) {
            fbNormal.divideScalar(fbLen);
            fbPlane.setFromNormalAndCoplanarPoint(fbNormal, sceneCenter);
            if (raycaster.ray.intersectPlane(fbPlane, fbPoint)) {
              hits = [{ point: fbPoint.clone(), distance: camera.position.distanceTo(fbPoint), face: null, object: null }];
            }
          }
        }
        if (hits.length) {
          var h = hits[0];
          over = true;
          tmpV.copy(h.point);
          if (h.face) {
            tmpN.copy(h.face.normal).applyMatrix3(hitNormalMat.getNormalMatrix(h.object.matrixWorld)).normalize();
          } else {
            camera.getWorldDirection(camDir); tmpN.copy(camDir).negate();
          }
          // flip the normal to face the camera
          camera.getWorldDirection(camDir);
          if (tmpN.dot(camDir) > 0) tmpN.negate();
          hitNormal.copy(tmpN);

          hitSpeed = lastHitValid ? tmpV.distanceTo(lastHit) / dt : 0;
          // keep the opening a consistent size on screen whatever the camera distance
          shared.uBrushR.value = Math.max(brushR, h.distance * cfg.brushScreenFraction);

          if (!headActive) {
            // first contact: start a fresh head
            headIndex = (headIndex + 1) % TRAIL_MAX;
            trail[headIndex].pos.copy(tmpV);
            trail[headIndex].w = 0;
            headActive = true;
          } else if (tmpV.distanceTo(trail[headIndex].pos) > trailStep) {
            // moved far enough: lay down a new trail point that inherits the current strength
            var prevW = trail[headIndex].w;
            headIndex = (headIndex + 1) % TRAIL_MAX;
            trail[headIndex].pos.copy(tmpV);
            trail[headIndex].w = prevW;
          } else {
            trail[headIndex].pos.copy(tmpV);
          }
          trail[headIndex].w = Math.min(1, trail[headIndex].w + dt * cfg.rampSpeed);

          lastHit.copy(tmpV); lastHitValid = true;
        }
      }
      if (!over) { headActive = false; lastHitValid = false; hitSpeed = 0; }

      // every non-head point decays; the slow close is the point of the effect
      for (i = 0; i < TRAIL_MAX; i++) {
        if (over && i === headIndex) continue;
        if (trail[i].w > 0) trail[i].w = Math.max(0, trail[i].w - dt * cfg.fadeSpeed);
      }
      /* The bounding sphere the shader tests before it runs the trail loop. Without this being
         maintained every frame the early-out sees a zero radius and kills the reveal outright. */
      var bMinX = 1e30, bMinY = 1e30, bMinZ = 1e30;
      var bMaxX = -1e30, bMaxY = -1e30, bMaxZ = -1e30, anyActive = 0;
      for (i = 0; i < TRAIL_MAX; i++) {
        var u = shared.uTrail.value[i];
        u.set(trail[i].pos.x, trail[i].pos.y, trail[i].pos.z, trail[i].w);
        if (trail[i].w <= 0) continue;
        anyActive = 1;
        var tx = trail[i].pos.x, ty = trail[i].pos.y, tz = trail[i].pos.z;
        if (tx < bMinX) bMinX = tx; if (tx > bMaxX) bMaxX = tx;
        if (ty < bMinY) bMinY = ty; if (ty > bMaxY) bMaxY = ty;
        if (tz < bMinZ) bMinZ = tz; if (tz > bMaxZ) bMaxZ = tz;
      }
      var bd = shared.uTrailBound.value;
      if (!anyActive) bd.set(0, 0, 0, 0);
      else {
        var bcx = (bMinX + bMaxX) * 0.5, bcy = (bMinY + bMaxY) * 0.5, bcz = (bMinZ + bMaxZ) * 0.5;
        // the brush reaches a full radius past the furthest trail point, plus the noisy edge
        var half = Math.hypot(bMaxX - bcx, bMaxY - bcy, bMaxZ - bcz);
        bd.set(bcx, bcy, bcz, half + brushR * 1.9);
      }

      /* --- particle emission --- */
      if (over && !reduced) {
        if (!wasOver) {
          for (i = 0; i < cfg.emitBurst; i++)
            emitParticle(lastHit.x, lastHit.y, lastHit.z, hitNormal.x, hitNormal.y, hitNormal.z, brushR * 0.35);
        }
        var rate = Math.min(cfg.emitRateMax, cfg.emitRate + hitSpeed / Math.max(1e-6, sceneSize) * 2600);
        emitAccum += rate * dt;
        var n2 = Math.floor(emitAccum); emitAccum -= n2;
        if (n2 > PC) n2 = PC;
        for (i = 0; i < n2; i++)
          emitParticle(lastHit.x, lastHit.y, lastHit.z, hitNormal.x, hitNormal.y, hitNormal.z, brushR * 0.35);
      }
      wasOver = over;

      /* --- particle simulation --- */
      var drag = Math.exp(-dt * 1.6);
      var lifeArr = lifeAttr.array;
      for (i = 0; i < PC; i++) {
        if (qLife[i] <= 0) { lifeArr[i] = 0; continue; }
        qLife[i] -= dt;
        if (qLife[i] <= 0) { qLife[i] = 0; lifeArr[i] = 0; continue; }
        var o3 = i * 3;
        // a gentle curl so they float rather than fly straight
        var cs = sceneSize * 0.03;
        qVel[o3] += Math.sin(time * 1.7 + qSeed[i] * 9.4) * cs * dt;
        qVel[o3 + 1] += Math.cos(time * 1.3 + qSeed[i] * 7.1) * cs * dt * 0.6;
        qVel[o3 + 2] += Math.cos(time * 1.9 + qSeed[i] * 5.3) * cs * dt;
        qVel[o3] *= drag; qVel[o3 + 1] *= drag; qVel[o3 + 2] *= drag;
        qPos[o3] += qVel[o3] * dt;
        qPos[o3 + 1] += qVel[o3 + 1] * dt;
        qPos[o3 + 2] += qVel[o3 + 2] * dt;
        lifeArr[i] = qMax[i] > 0 ? qLife[i] / qMax[i] : 0;
      }
      partGeo.attributes.position.needsUpdate = true;
      lifeAttr.needsUpdate = true;

      /* --- dust drift --- */
      if (dust && !reduced) {
        var dp = dustGeo.attributes.position.array, bp = dust.userData.basePos;
        for (i = 0; i < cfg.dustCount; i++) {
          var d3 = i * 3, sd = dustGeo.attributes.aSeed.array[i];
          dp[d3] = bp[d3] + Math.sin(time * 0.21 + sd * 12.0) * sceneSize * 0.012;
          dp[d3 + 1] = bp[d3 + 1] + ((time * 0.012 * sceneSize + sd * sceneSizeV.y) % sceneSizeV.y) - sceneSizeV.y * 0.5;
          dp[d3 + 2] = bp[d3 + 2] + Math.cos(time * 0.17 + sd * 9.0) * sceneSize * 0.012;
        }
        dustGeo.attributes.position.needsUpdate = true;
      }
    }

    function setEnabled(v) {
      enabled = !!v;
      points.visible = enabled;
      if (webLines) webLines.visible = enabled;
      if (strayLines) strayLines.visible = enabled;
      if (dust) dust.visible = enabled;
      particles.visible = enabled;
      if (!enabled) {
        // open every material back up so the meshes render normally while disabled
        for (var k = 0; k < TRAIL_MAX; k++) { trail[k].w = 0; shared.uTrail.value[k].set(0, 0, 0, 0); }
        shared.uRevealAll.value = 1;   // meshes render normally while the effect is off
      } else {
        shared.uRevealAll.value = 0;
      }
    }

    function dispose() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('pointerleave', onPointerLeave);
      if (loadingTimer) clearTimeout(loadingTimer);

      scene.remove(points); ptGeo.dispose(); ptMat.dispose();
      if (webLines) { scene.remove(webLines); webGeo.dispose(); webMat.dispose(); }
      if (strayLines) { scene.remove(strayLines); strayLines.geometry.dispose(); strayLines.material.dispose(); }
      if (dust) { scene.remove(dust); dustGeo.dispose(); dustMat.dispose(); }
      scene.remove(particles); partGeo.dispose(); partMat.dispose();

      // restore the original materials
      for (i = 0; i < solidMeshes.length; i++) scene.remove(solidMeshes[i]);
      solidMeshes.length = 0;
      if (solidMat) solidMat.dispose();
      if (xrayMat) {
        for (i = 0; i < targets.length && i < originalMats.length; i++) targets[i].material = originalMats[i];
        xrayMat.dispose();
      }
      for (i = 0; i < patched.length; i++) {
        var pm = patched[i];
        delete pm.userData.__scanRevealPatched;
        delete pm.userData.__scanShader;
        pm.onBeforeCompile = function () {};
        pm.customProgramCacheKey = function () { return ''; };
        pm.needsUpdate = true;
      }
      patched.length = 0;

      if (ownComposer && composer) {
        if (bloomPass && bloomPass.dispose) bloomPass.dispose();
        if (composer.renderTarget1) composer.renderTarget1.dispose();
        if (composer.renderTarget2) composer.renderTarget2.dispose();
      }
      renderer.setPixelRatio(prevPixelRatio);
    }

    /* Hosts that track the pointer themselves — because they tear this effect down and rebuild
       it as content swaps — push the current position in directly, so the reveal survives the
       handover instead of waiting for the reader to move the mouse again. */
    function setPointer(clientX, clientY, inside, active) {
      var rect = dom.getBoundingClientRect();
      if (rect.width && rect.height) {
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      }
      if (typeof inside === 'boolean') pointerInside = inside;
      if (typeof active === 'boolean') pointerActive = active;
    }

    return {
      update: update,
      setEnabled: setEnabled,
      setPointer: setPointer,
      pointerState: function () {
        return { x: pointer.x, y: pointer.y, inside: pointerInside, active: pointerActive };
      },
      dispose: dispose,
      // handy for tuning and for wiring into an existing loop
      composer: composer,
      ownsComposer: ownComposer,
      points: points,
      xrayMaterial: xrayMat,
      solidMaterial: solidMat,
      web: webLines,
      strays: strayLines,
      dust: dust,
      particles: particles,
      targets: targets,
      config: cfg,
      uniforms: shared,
      stats: {
        pointCount: pointTotal,
        webSegments: webGeo ? webGeo.attributes.position.count / 2 : 0,
        targetCount: targets.length,
        skinnedMeshes: skinnedSkipped,
        sceneSize: sceneSize,
        brushRadius: brushR
      }
    };
  }

  return { createScanReveal: createScanReveal, DEFAULTS: DEFAULTS };
});
