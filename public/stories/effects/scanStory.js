/* scanStory.js — wires the scan-reveal effect into a PointStory page.

       PointStory.run({ scenes, shots, onReady: ctx => ScanStory.attach(ctx, opts) });

   The story engine already draws the cloud, so this does NOT add a second one. It:
     · reconstructs real triangle meshes for the scene the reader is currently on,
     · adds them to the engine's scene with lights, discarded outside the brush,
     · lets scanReveal own the pointer, the trail and the reveal particles,
     · mirrors the trail into the engine's own point shader, so the engine's cloud lifts,
       fades and glows at the rim exactly like the meshes do,
     · rebuilds on scene change, in background slices, so scrolling never stalls.

   Meshes for a scene cost a few hundred milliseconds to reconstruct, so they are cached and
   built one chunk per idle slice. Until a scene's meshes are ready the page simply behaves as
   it always did — the reveal turns itself on when there is something to reveal.              */
(function (root) {
  'use strict';

  var DEFAULTS = {
    brushRadius: 0.16,
    // true: only scenes with hand-modelled landmarks get the reveal. A reconstructed surface is
    // too sparse to fill an opening, so revealing onto one punches dark holes in the cloud.
    modelledOnly: true,      // fraction of the scene's own extent
    cacheScenes: 3,         // reconstructed scenes kept in memory
    meshBudgetMs: 7,        // reconstruction work per idle slice
    lift: 0.05,             // how far engine points lift inside the opening, x scene size
    edgeWidth: 0.12,
    noiseScale: 1.6,
    meshColor: 0xb7c3d6,
    meshRoughness: 0.82,
    rimColor: 0x22c07a,      // royal green, matching the film
    particleCount: 4000,
    emitRate: 140,
    resolution: 132,        // reconstruction detail (desktop); phones get less
    resolutionMobile: 84,
    enabled: true
  };

  function attach(ctx, options) {
    var THREE = ctx.THREE;
    var cfg = Object.assign({}, DEFAULTS, options || {});
    if (!root.Meshify || !root.createScanReveal) {
      console.warn('scanStory: meshify.js and scanReveal.js must load first');
      return null;
    }
    if (ctx.reduced || !cfg.enabled) return null;   // prefers-reduced-motion: leave the page alone

    var small = ctx.isSmall;
    var uni = ctx.uniforms;

    // lights for the revealed meshes. Every other object in this scene is a raw ShaderMaterial
    // and ignores lights entirely, so adding them changes nothing that already renders.
    var hemi = new THREE.HemisphereLight(0x9fc4ff, 0x0a0f18, 0.55);
    var key = new THREE.DirectionalLight(0xfff0dd, 1.15);
    key.position.set(-0.45, 0.72, 0.53).multiplyScalar(100);   // matches the engine's baked key light
    var fill = new THREE.DirectionalLight(0x6f8fc4, 0.3);
    fill.position.set(60, 20, -50);
    ctx.scene.add(hemi, key, fill);

    var material = new THREE.MeshStandardMaterial({
      color: cfg.meshColor, roughness: cfg.meshRoughness, metalness: 0.02,
      emissive: 0x0a1220, emissiveIntensity: 1.0
    });

    var cache = new Map();      // sceneId -> {meshes, size}
    var job = null;             // {id, iter} in-flight reconstruction
    var current = null;         // sceneId whose meshes are in the scene
    var scan = null;
    var lastShot = -1;
    var idleTimer = null;

    /* The reader scrolls through scenes, and each swap rebuilds the effect on new targets.
       Tracking the pointer here — above that churn — means a reveal in progress carries across
       a scene change instead of dying until the mouse moves again. */
    var ptr = { x: 0, y: 0, inside: false, active: !matchMedia('(hover: none)').matches };
    var dom = ctx.renderer.domElement;
    function onMove(e) {
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true;
      if (e.pointerType === 'touch' && !ptr.active) return;
      if (scan) scan.setPointer(ptr.x, ptr.y, true, ptr.active);
    }
    function onDown(e) { if (e.pointerType === 'touch') { ptr.active = true; onMove(e); } }
    function onUp(e) { if (e.pointerType === 'touch') { ptr.active = false; if (scan) scan.setPointer(ptr.x, ptr.y, ptr.inside, false); } }
    function onLeave() { ptr.inside = false; if (scan) scan.setPointer(ptr.x, ptr.y, false); }
    // The page stacks .track and the caption sections on top of the canvas, so listeners bound
    // to the canvas never fire. The engine itself listens on window for the same reason.
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointerdown', onDown, { passive: true });
    addEventListener('pointerup', onUp, { passive: true });
    addEventListener('pointercancel', onUp, { passive: true });
    addEventListener('pointerleave', onLeave, { passive: true });

    // ---- reconstruction, one scene at a time, off the critical path ----
    function startBuild(id) {
      if (cache.has(id) || (job && job.id === id)) return;

      /* A hand-modelled landmark beats a reconstruction every time: surface nets recovers the
         mass of the cloud but none of its edges. Where one exists, use it and skip the
         reconstruction pass entirely. */
      if (root.Landmarks && root.Landmarks.has(id)) {
        var ms = root.Landmarks.build(id, THREE, material);
        if (ms.length) {
          var off = ctx.sceneOffset(id);
          var box0 = new THREE.Box3();
          ms.forEach(function (m) {
            m.position.x += off[0]; m.position.y += off[1]; m.position.z += off[2];
            m.updateMatrixWorld(true);
            box0.expandByObject(m);
          });
          var s0 = box0.getSize(new THREE.Vector3());
          cache.set(id, { meshes: ms, size: Math.max(s0.x, s0.y, s0.z) || 1, modelled: true });
          if (id === wantedScene()) show(id);
          return;
        }
      }

      // Reconstruction covers only ~83% of a scene, and only as soft blobs. Opening the cloud
      // onto that leaves holes with nothing behind them — which is what reads as black patches.
      // So the reveal runs only where there is modelled geometry worth showing.
      if (cfg.modelledOnly !== false) return;

      var data;
      try { data = ctx.sceneData(id); } catch (e) { return; }
      if (!data || !data.pts) return;
      job = { id: id, done: false };
      root.Meshify.meshifySceneWorker({
        THREE: THREE, pts: data.pts, nrm: data.nrm, spacing: data.sp, material: material,
        config: {
          maxRes: small ? cfg.resolutionMobile : cfg.resolution,
          chunkTarget: small ? 4 : 8
        }
      }).then(function (meshes) {
        if (!job || job.id !== id) return;
        job = null;
        // cap the cache, never evicting what is on screen
        while (cache.size >= cfg.cacheScenes) {
          var victim = null;
          cache.forEach(function (v, k) { if (victim === null && k !== current) victim = k; });
          if (victim === null) break;
          disposeMeshes(cache.get(victim).meshes);
          cache.delete(victim);
        }
        var box = new THREE.Box3();
        meshes.forEach(function (m) { box.expandByObject(m); });
        var sz = box.getSize(new THREE.Vector3());
        cache.set(id, { meshes: meshes, size: Math.max(sz.x, sz.y, sz.z) || 1 });
        if (id === wantedScene()) show(id);
      });
    }

    function disposeMeshes(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].parent) list[i].parent.remove(list[i]);
        list[i].geometry.dispose();
      }
    }

    function wantedScene() { return ctx.sceneOf(ctx.shot()); }

    // ---- swap which scene's meshes are live ----
    function show(id) {
      var entry = cache.get(id);
      if (!entry || current === id) return;
      if (current && cache.has(current)) {
        cache.get(current).meshes.forEach(function (m) { ctx.scene.remove(m); });
      }
      if (scan) { scan.dispose(); scan = null; }
      entry.meshes.forEach(function (m) { ctx.scene.add(m); });
      current = id;

      scan = root.createScanReveal({
        THREE: THREE, renderer: ctx.renderer, scene: ctx.scene, camera: ctx.camera,
        targets: entry.meshes,
        options: {
          pointCloud: false,          // the story engine already draws the cloud
          post: false,                // and already has bloom, god-rays and tone mapping
          brushRadius: cfg.brushRadius,
          edgeWidth: cfg.edgeWidth,
          noiseScale: cfg.noiseScale,
          rimColor: cfg.rimColor,
          particleCount: small ? Math.round(cfg.particleCount / 2) : cfg.particleCount,
          emitRate: cfg.emitRate,
          maxPixelRatio: 99           // the engine owns its own pixel-ratio policy
        },
        initialPointer: { x: 0, y: 0, inside: ptr.inside, active: ptr.active }
      });
      if (ptr.inside) scan.setPointer(ptr.x, ptr.y, true, ptr.active);

      // hand the engine's own point shader the same brush the meshes use
      uni.uScanR.value = scan.stats.brushRadius;
      uni.uScanNoise.value = cfg.noiseScale / entry.size;
      uni.uScanLift.value = cfg.lift * entry.size;
      uni.uScanEdge.value = cfg.edgeWidth;
      uni.uScanOn.value = 1;
    }

    // ---- per frame ----
    ctx.hooks.onFrame = function (dt) {
      var want = wantedScene();
      if (want !== lastShot) {
        lastShot = want;
        if (cache.has(want)) show(want);
        else startBuild(want);
      }
      if (!scan) { uni.uScanOn.value = 0; return; }

      /* The engine morphs between two scene slots across a transition, so a landmark keyed only
         to the current shot pops in while its own cloud is still arriving — which is what leaves
         geometry stranded mid-scroll. Track how present this scene actually is and fade with it. */
      var sl = ctx.slots(), w = uni.uW.value, present = 0;
      if (sl[0] === current) present += 1 - w;
      if (sl[1] === current) present += w;
      if (scan.xrayMaterial) scan.xrayMaterial.uniforms.uSceneFade.value = present;
      if (scan.solidMaterial) scan.solidMaterial.uniforms.uSceneFade.value = present;
      // Bailing out here stopped scan.update() running at all, so the trail never built while
      // a scene was arriving and the reveal looked dead. Fade the visuals, keep the brush alive.
      uni.uScanOn.value = present > 0.002 ? 1 : 0;

      scan.update(dt);

      // mirror the trail into the engine's uniforms so the cloud opens with the mesh
      var src = scan.uniforms.uTrail.value, dst = uni.uScanTrail.value;
      for (var i = 0; i < dst.length && i < src.length; i++) dst[i].copy(src[i]);
    };

    // build the current scene now, and keep a low-priority queue for neighbours
    startBuild(wantedScene());
    idleTimer = setInterval(function () {
      if (job) return;
      var shot = ctx.shot();
      for (var d = 1; d <= 2; d++) {
        for (var k = 0; k < 2; k++) {
          var id = ctx.sceneOf(shot + (k ? -d : d));
          if (!cache.has(id)) { startBuild(id); return; }
        }
      }
    }, 400);

    return {
      setEnabled: function (v) {
        if (scan) scan.setEnabled(v);
        uni.uScanOn.value = v && scan ? 1 : 0;
        if (current && cache.has(current)) {
          cache.get(current).meshes.forEach(function (m) { m.visible = !!v; });
        }
      },
      dispose: function () {
        clearInterval(idleTimer);
        removeEventListener('pointermove', onMove);
        removeEventListener('pointerdown', onDown);
        removeEventListener('pointerup', onUp);
        removeEventListener('pointercancel', onUp);
        removeEventListener('pointerleave', onLeave);
        ctx.hooks.onFrame = null;
        uni.uScanOn.value = 0;
        if (scan) { scan.dispose(); scan = null; }
        cache.forEach(function (v) { disposeMeshes(v.meshes); });
        cache.clear();
        ctx.scene.remove(hemi, key, fill);
        material.dispose();
      },
      get scan() { return scan; },
      get sceneId() { return current; },
      cacheSize: function () { return cache.size; },
      config: cfg
    };
  }

  root.ScanStory = { attach: attach, DEFAULTS: DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
