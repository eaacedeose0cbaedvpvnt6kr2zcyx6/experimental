/* landmarks.js — real, hand-modelled geometry for the hero subjects.

   The point cloud defines the art, but it cannot hold a crisp edge: 450k samples spread over an
   80-unit scene simply do not carry architectural detail, and reconstructing a surface from them
   (effects/meshify.js) recovers the mass, not the detail. So the subjects a reader actually looks
   at are modelled here as true parametric geometry, matched to the coordinates the scene samplers
   already use, and the cloud stays as the surrounding atmosphere.

   Dimensions are taken from the scene builders in isra-miraj.html so the geometry lands exactly
   on top of its own point cloud:
     Kaaba  — half-width 4, half-depth 3.5, height 10; plinth below y=0.45; hizam band y 6.7-7.75;
              door on the +z face x 0.4-3.2, y 1.7-7.1; Black Stone corner at y=1.5;
              Hijr Ismail arc of radius 4.5-5 centred on x=-4, height 1.3.
     Dome of the Rock — octagon circumradius 10 to y=7.8; drum radius 5.3 to y=11;
              dome radius 5.6 rising 6.4 above y=11; finial to y=19.4; crescent at y=20.

   Every part is a separate mesh so the x-ray reveal stacks them into a section view.            */
(function (root) {
  'use strict';

  function mat(THREE, opts) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: 0xb9c4d4, roughness: 0.85, metalness: 0.02
    }, opts || {}));
  }

  function mesh(THREE, geo, material, name, pos, rot) {
    var m = new THREE.Mesh(geo, material);
    m.name = name;
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    m.userData.landmark = true;
    return m;
  }

  /* ---------------- the Kaaba ---------------- */
  function kaaba(THREE, material) {
    var W = 4, D = 3.5, H = 10;
    var out = [];
    var M = material || mat(THREE);

    // the cube itself, sitting on the ground
    out.push(mesh(THREE, new THREE.BoxGeometry(W * 2, H, D * 2, 4, 10, 4), M, 'kaaba_body', [0, H / 2, 0]));

    // shadharwan: the sloping marble plinth, flaring out at the foot. A 4-segment cylinder is a
    // square prism whose vertices sit at radius 1, so a half-extent of e needs a scale of e*sqrt(2).
    var pl = new THREE.CylinderGeometry(0.88, 1, 1, 4, 1, false, Math.PI / 4);
    out.push((function () {
      var m = mesh(THREE, pl, M, 'kaaba_plinth', [0, 0.225, 0]);
      m.scale.set((W + 0.42) * Math.SQRT2, 0.45, (D + 0.42) * Math.SQRT2);
      return m;
    })());

    // hizam: the embroidered band, standing slightly proud of the cloth
    out.push(mesh(THREE, new THREE.BoxGeometry(W * 2 + 0.14, 1.05, D * 2 + 0.14, 3, 1, 3), M,
      'kaaba_hizam', [0, 7.225, 0]));

    // the door, recessed into the north-east face
    out.push(mesh(THREE, new THREE.BoxGeometry(2.0, 4.0, 0.22, 2, 4, 1), M,
      'kaaba_door', [1.8, 4.1, D + 0.02]));
    out.push(mesh(THREE, new THREE.BoxGeometry(2.8, 5.4, 0.1, 1, 1, 1), M,
      'kaaba_door_frame', [1.8, 4.4, D + 0.005]));

    // the Black Stone in its silver frame, on the eastern corner
    var ring = new THREE.TorusGeometry(0.32, 0.075, 12, 28);
    out.push(mesh(THREE, ring, M, 'kaaba_blackstone', [W - 0.02, 1.5, D - 0.02], [0, Math.PI / 4, 0]));

    // Hijr Ismail: the low arc wall off the north-west face
    var hijr = new THREE.CylinderGeometry(5.0, 5.0, 1.3, 48, 1, true, -Math.PI / 2, Math.PI);
    out.push((function () {
      var m = mesh(THREE, hijr, M, 'hijr_outer', [-W, 0.65, 0]);
      m.rotation.y = Math.PI;   // open side faces the Kaaba
      return m;
    })());
    var hijrIn = new THREE.CylinderGeometry(4.5, 4.5, 1.3, 48, 1, true, -Math.PI / 2, Math.PI);
    out.push((function () {
      var m = mesh(THREE, hijrIn, M, 'hijr_inner', [-W, 0.65, 0]);
      m.rotation.y = Math.PI;
      return m;
    })());

    return out;
  }

  /* ---------------- the Dome of the Rock ---------------- */
  function domeOfRock(THREE, material) {
    var out = [];
    var M = material || mat(THREE);

    // octagonal arcade wall, circumradius 10, up to the cornice
    out.push(mesh(THREE, new THREE.CylinderGeometry(10, 10, 7.8, 8, 2, true), M,
      'dor_octagon', [0, 3.9, 0], [0, Math.PI / 8, 0]));
    // cornice band
    out.push(mesh(THREE, new THREE.CylinderGeometry(10.5, 10.5, 0.55, 8, 1, true), M,
      'dor_cornice', [0, 7.95, 0], [0, Math.PI / 8, 0]));

    // drum
    out.push(mesh(THREE, new THREE.CylinderGeometry(5.3, 5.3, 3.2, 40, 2, true), M,
      'dor_drum', [0, 9.4, 0]));
    out.push(mesh(THREE, new THREE.CylinderGeometry(5.7, 5.7, 0.4, 40, 1, true), M,
      'dor_drum_cornice', [0, 11.0, 0]));

    // the dome: a hemisphere of radius 5.6, stretched to rise 6.4
    var dome = new THREE.SphereGeometry(5.6, 56, 28, 0, Math.PI * 2, 0, Math.PI / 2);
    out.push((function () {
      var m = mesh(THREE, dome, M, 'dor_dome', [0, 11, 0]);
      m.scale.set(1, 6.4 / 5.6, 1);
      return m;
    })());

    // finial and crescent
    out.push(mesh(THREE, new THREE.CylinderGeometry(0.1, 0.2, 2.0, 14), M, 'dor_finial', [0, 18.4, 0]));
    out.push(mesh(THREE, new THREE.TorusGeometry(0.55, 0.065, 10, 30, 4.9), M,
      'dor_crescent', [0, 20, 0], [0, Math.PI / 2, 0.6]));

    // the inner colonnade that carries the drum — the part an x-ray section should reveal
    for (var c = 0; c < 16; c++) {
      var ca = c / 16 * Math.PI * 2;
      out.push(mesh(THREE, new THREE.CylinderGeometry(0.28, 0.32, 7.4, 12), M,
        'dor_column_' + c, [Math.cos(ca) * 5.3, 3.7, Math.sin(ca) * 5.3]));
    }
    // and the rock itself, under the dome
    var rock = new THREE.SphereGeometry(2.6, 20, 14);
    out.push((function () {
      var m = mesh(THREE, rock, M, 'dor_rock', [0, 0.5, 0]);
      m.scale.set(1.5, 0.52, 1.25);
      return m;
    })());

    return out;
  }

  function makkah(THREE, material) {
    var M = material || mat(THREE);
    return kaaba(THREE, M).concat(portico(THREE, M)).concat([tawafCrowd(THREE, M, 260)]);
  }

  var BUILDERS = { kaaba: kaaba, makkah: makkah, aqsa: domeOfRock, dome: domeOfRock,
    hall: prophetsHall, vessels: vessels, rivers: rivers, dawn: dawn, vision: vision };

  /* ---------------- a robed human figure ----------------
     One geometry, reused through an InstancedMesh: a crowd of several hundred costs one draw
     call, and scanReveal already folds instanceMatrix into its sampling and raycasting.
     Built around a 1.75-unit standing height, so an instance scales by height/1.75.        */
  function figureGeometry(THREE) {
    var parts = [];
    function add(g, x, y, z, sx, sy, sz) {
      g.scale(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
      g.translate(x, y, z);
      parts.push(g);
    }
    // robe: a tapered skirt from the ground to the shoulders
    add(new THREE.CylinderGeometry(0.19, 0.33, 1.12, 12, 1, true), 0, 0.56, 0);
    // torso and shoulders
    add(new THREE.SphereGeometry(0.21, 12, 9), 0, 1.30, 0, 1.18, 0.78, 0.86);
    // neck
    add(new THREE.CylinderGeometry(0.055, 0.07, 0.1, 8), 0, 1.47, 0);
    // head, slightly egg-shaped
    add(new THREE.SphereGeometry(0.108, 14, 11), 0, 1.60, 0, 1, 1.16, 1);
    // arms, held close to the body
    add(new THREE.CylinderGeometry(0.052, 0.045, 0.62, 8), 0.205, 1.00, 0.02);
    add(new THREE.CylinderGeometry(0.052, 0.045, 0.62, 8), -0.205, 1.00, 0.02);

    if (THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries) {
      return THREE.BufferGeometryUtils.mergeBufferGeometries(parts, false);
    }
    return mergeGeometries(THREE, parts);
  }

  /* ---------------- a camel ---------------- */
  function camelGeometry(THREE) {
    var parts = [];
    function add(g, x, y, z, sx, sy, sz, rz) {
      if (rz) g.rotateZ(rz);
      g.scale(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
      g.translate(x, y, z);
      parts.push(g);
    }
    // barrel body
    add(new THREE.SphereGeometry(0.62, 16, 12), 0, 1.42, 0, 1.55, 0.86, 0.80);
    // the hump
    add(new THREE.SphereGeometry(0.34, 14, 10), -0.06, 1.95, 0, 1.15, 0.92, 0.92);
    // neck rising forward, then the head
    add(new THREE.CylinderGeometry(0.15, 0.22, 1.05, 10), 0.80, 2.05, 0, 1, 1, 1, -0.42);
    add(new THREE.SphereGeometry(0.17, 12, 10), 1.20, 2.52, 0, 1.35, 0.85, 0.85);
    add(new THREE.SphereGeometry(0.09, 10, 8), 1.46, 2.44, 0, 1.25, 0.72, 0.8);
    // four legs
    var LX = [0.48, 0.48, -0.44, -0.44], LZ = [0.27, -0.27, 0.29, -0.29];
    for (var i = 0; i < 4; i++) {
      add(new THREE.CylinderGeometry(0.068, 0.052, 1.42, 8), LX[i], 0.71, LZ[i]);
    }
    // tail
    add(new THREE.CylinderGeometry(0.03, 0.02, 0.5, 6), -0.90, 1.35, 0, 1, 1, 1, 0.5);

    if (THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries) {
      return THREE.BufferGeometryUtils.mergeBufferGeometries(parts, false);
    }
    return mergeGeometries(THREE, parts);
  }

  /* r128's merge helper lives in an examples file the story pages do not load, so merge the
     position/normal streams here rather than adding another script tag. */
  function mergeGeometries(THREE, parts) {
    var total = 0, i, j;
    for (i = 0; i < parts.length; i++) {
      parts[i] = parts[i].index ? parts[i].toNonIndexed() : parts[i];
      total += parts[i].attributes.position.count;
    }
    var pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), o = 0;
    for (i = 0; i < parts.length; i++) {
      var g = parts[i];
      if (!g.attributes.normal) g.computeVertexNormals();
      var p = g.attributes.position.array, n = g.attributes.normal.array;
      for (j = 0; j < p.length; j++) { pos[o + j] = p[j]; nrm[o + j] = n[j]; }
      o += p.length;
      g.dispose();
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }

  /* ---------------- the Ottoman portico around the mataf ----------------
     Matches genKaaba's own parameters: a superelliptical plan of radius 36*sup(th), two storeys
     of arches to y=14, column rows at 2.4/5.4 and 1.8/5.2, and a dome over every other bay.  */
  function portico(THREE, material) {
    var M = material || mat(THREE);
    var out = [];
    var sup = function (th) {
      var c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
      return 1 / Math.pow(c * c * c * c + s * s * s * s, 0.25);
    };
    var NB = Math.floor(Math.PI * 2 * 40 / 3.6);   // bay count, as the sampler computes it

    // the wall itself, as a ring of bay-wide panels following the superellipse
    for (var k = 0; k < NB; k++) {
      var th = k / NB * Math.PI * 2;
      var r = 36 * sup(th);
      var cx = Math.cos(th) * r, cz = Math.sin(th) * r;
      var w = Math.PI * 2 * r / NB * 0.52;
      // two storeys: a pier either side of each arch, and a spandrel over it
      for (var st = 0; st < 2; st++) {
        var y0 = st * 7;
        out.push(mesh(THREE, new THREE.BoxGeometry(w * 0.34, 5.6, 1.5), M,
          'portico_pier_' + k + '_' + st, [cx, y0 + 2.8, cz], [0, -th, 0]));
        out.push(mesh(THREE, new THREE.BoxGeometry(w * 1.02, 1.4, 1.5), M,
          'portico_lintel_' + k + '_' + st, [cx, y0 + 6.3, cz], [0, -th, 0]));
      }
      // the little dome capping every other bay
      if (k % 2 === 0) {
        var dome = new THREE.SphereGeometry(1.45, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        out.push((function (gx, gz, gth) {
          var m = mesh(THREE, dome, M, 'portico_dome_' + k, [gx, 14, gz], [0, -gth, 0]);
          m.scale.set(1, 0.8, 1);
          return m;
        })(cx, cz, th));
      }
      // inner colonnade rows
      if (k % 2 === 0) {
        for (var row = 0; row < 2; row++) {
          var rr = r - (row ? 5.4 : 2.4);
          out.push(mesh(THREE, new THREE.CylinderGeometry(0.26, 0.3, 13.6, 10), M,
            'portico_col_' + k + '_' + row, [Math.cos(th) * rr, 6.8, Math.sin(th) * rr]));
        }
      }
    }
    return out;
  }

  /* the tawaf crowd, as instances on the same radii the sampler uses (6.4 .. 27.4) */
  function tawafCrowd(THREE, material, count) {
    var n = count || 260;
    var geo = figureGeometry(THREE);
    var inst = new THREE.InstancedMesh(geo, material || mat(THREE), n);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (var i = 0; i < n; i++) {
      var r = 6.4 + Math.pow(Math.random(), 1.6) * 21;
      var th = Math.random() * Math.PI * 2;
      var h = 1.55 + Math.random() * 0.3;
      v.set(Math.cos(th) * r, 0, Math.sin(th) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -th + Math.PI / 2);
      sc.setScalar(h / 1.75);
      m4.compose(v, q, sc);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.name = 'tawaf_crowd';
    inst.userData.landmark = true;
    inst.frustumCulled = false;
    return inst;
  }

  /* A resting caravan on the approach. Camels belong outside the sanctuary, not on the mataf,
     so they ring the scene beyond the portico line where caravans actually couched. */
  function camelTrain(THREE, material, count) {
    var n = count || 16;
    var geo = camelGeometry(THREE);
    var inst = new THREE.InstancedMesh(geo, material || mat(THREE), n);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(),
        sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    var sup = function (th) {
      var c = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
      return 1 / Math.pow(c * c * c * c + sn * sn * sn * sn, 0.25);
    };
    // loose groups rather than an even ring, so it reads as arrivals and not as decoration
    var groups = [0.55, 1.9, 3.3, 4.6];
    for (var i = 0; i < n; i++) {
      var th = groups[i % groups.length] + (Math.random() - 0.5) * 0.42;
      var r = 36 * sup(th) + 5 + Math.random() * 11;
      v.set(Math.cos(th) * r, 0, Math.sin(th) * r);
      q.setFromAxisAngle(up, -th + Math.PI / 2 + (Math.random() - 0.5) * 1.1);
      sc.setScalar(0.92 + Math.random() * 0.22);
      m4.compose(v, q, sc);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.name = 'camel_train';
    inst.userData.landmark = true;
    inst.frustumCulled = false;
    return inst;
  }

  /* ---------------- the hall of the prophets ----------------
     The sampler lays out a colonnaded hall: piers on x = ±4 and ±9 every 4.5 units from z=-2
     back to z=-44, an arcade carried above them, a mihrab niche in the qibla wall, and the
     prophets ranked 9 across and 5 deep from z=-14. Modelled here so the ranks actually read
     as ranks — the point cloud dissolved them into the floor.                              */
  function prophetsHall(THREE, material) {
    var M = material || mat(THREE);
    var out = [];
    var colX = [-9, -4, 4, 9], colZ = [];
    for (var z = -2; z > -44; z -= 4.5) colZ.push(z);

    // floor and qibla wall
    // the qibla end reads as a frame around the niche, not as a wall filling the view
    out.push(mesh(THREE, new THREE.BoxGeometry(24, 0.6, 0.5), M, 'hall_qibla_head', [0, 8.7, -44.2]));
    out.push(mesh(THREE, new THREE.BoxGeometry(2.2, 9, 0.5), M, 'hall_qibla_jambL', [-4.6, 4.5, -44.2]));
    out.push(mesh(THREE, new THREE.BoxGeometry(2.2, 9, 0.5), M, 'hall_qibla_jambR', [4.6, 4.5, -44.2]));

    for (var i = 0; i < colX.length; i++) {
      for (var j = 0; j < colZ.length; j++) {
        out.push(mesh(THREE, new THREE.CylinderGeometry(0.32, 0.36, 5.6, 14), M,
          'hall_col_' + i + '_' + j, [colX[i], 2.8, colZ[j]]));
        out.push(mesh(THREE, new THREE.BoxGeometry(1.0, 0.7, 1.0), M,
          'hall_cap_' + i + '_' + j, [colX[i], 5.95, colZ[j]]));
      }
      // the arcade the capitals carry: a spandrel between each pair of columns
      for (j = 0; j < colZ.length - 1; j++) {
        var mz = (colZ[j] + colZ[j + 1]) / 2;
        out.push(mesh(THREE, new THREE.BoxGeometry(0.62, 3.0, 1.6), M,
          'hall_arch_' + i + '_' + j, [colX[i], 7.8, mz]));
      }
      out.push(mesh(THREE, new THREE.BoxGeometry(0.72, 0.5, 42), M,
        'hall_beam_' + i, [colX[i], 9.15, -23]));
    }

    // mihrab: a half-cylinder niche with a semi-dome, set into the qibla wall
    out.push((function () {
      var g = new THREE.CylinderGeometry(1.3, 1.3, 3.6, 20, 1, true, 0, Math.PI);
      var m = mesh(THREE, g, M, 'hall_mihrab', [0, 1.8, -44], [0, -Math.PI / 2, 0]);
      m.scale.set(1, 1, 0.85);
      return m;
    })());
    out.push((function () {
      var g = new THREE.SphereGeometry(1.3, 20, 10, 0, Math.PI, 0, Math.PI / 2);
      var m = mesh(THREE, g, M, 'hall_mihrab_hood', [0, 3.6, -44], [0, -Math.PI / 2, 0]);
      m.scale.set(1, 1, 0.85);
      return m;
    })());

    // the ranks: nine across, five deep, exactly where the sampler puts them
    var geo = figureGeometry(THREE);
    var rows = 5, cols = 9;
    var inst = new THREE.InstancedMesh(geo, M, rows * cols);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(),
        sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    var k = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        v.set(-8 + c * 2, 0, -14 - r * 3.2);
        q.setFromAxisAngle(up, Math.PI);          // all facing the qibla wall
        sc.setScalar(1.0 + (((r * 9 + c) % 5) - 2) * 0.012);
        m4.compose(v, q, sc);
        inst.setMatrixAt(k++, m4);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.name = 'hall_ranks';
    inst.userData.landmark = true;
    inst.frustumCulled = false;
    out.push(inst);

    // the imam, standing alone ahead of the ranks
    var imam = mesh(THREE, figureGeometry(THREE), M, 'hall_imam', [0, 0, -38], [0, Math.PI, 0]);
    imam.scale.setScalar(1.85 / 1.75);
    out.push(imam);

    return out;
  }

  /* ---------------- the two vessels: milk and wine ----------------
     A stone table with two cups on it. The cloud read as a smear; the point of the scene is that
     there are exactly two, and that one is chosen. Cup profile follows the sampler's jr(y).   */
  function vessels(THREE, material) {
    var M = material || mat(THREE);
    var out = [];
    out.push(mesh(THREE, new THREE.BoxGeometry(2.3, 0.86, 1.05, 2, 1, 1), M, 'vessel_table', [0, 0.43, 0]));

    function cup(cx, name, tall) {
      var g = [];
      // bowl: a lathe profile, open at the top
      var pts = [];
      for (var i = 0; i <= 12; i++) {
        var t = i / 12, y = t * (tall ? 0.62 : 0.5);
        pts.push(new THREE.Vector2(0.10 + 0.32 * Math.sin(Math.PI * 0.5 * (0.35 + t * 0.65)), y));
      }
      var bowl = new THREE.LatheGeometry(pts, 28);
      out.push(mesh(THREE, bowl, M, name + '_bowl', [cx, 0.9, 0]));
      out.push(mesh(THREE, new THREE.CylinderGeometry(0.09, 0.15, 0.16, 16), M, name + '_foot', [cx, 0.9, 0]));
      // the liquid surface, a disc just below the rim
      out.push((function () {
        var d = new THREE.CylinderGeometry(0.33, 0.33, 0.012, 28);
        return mesh(THREE, d, M, name + '_surface', [cx, 0.9 + (tall ? 0.52 : 0.42), 0]);
      })());
      return g;
    }
    cup(-0.6, 'vessel_milk', true);
    cup(0.6, 'vessel_wine', false);
    return out;
  }

  /* ---------------- the four rivers ----------------
     Four channels leaving one source: two run on the surface, two go under. The scene needs the
     count and the common origin to be legible, which a scatter of points never gave.          */
  function rivers(THREE, material) {
    var M = material || mat(THREE);
    var out = [];
    var dirs = [[0.4, 1], [0.4 + Math.PI / 2, 1], [0.4 + Math.PI, 0], [0.4 + Math.PI * 1.5, 0]];

    // the source basin
    out.push(mesh(THREE, new THREE.CylinderGeometry(3.0, 3.4, 1.1, 40), M, 'rivers_basin', [0, 0.55, 0]));
    out.push(mesh(THREE, new THREE.CylinderGeometry(2.6, 2.6, 0.06, 40), M, 'rivers_pool', [0, 1.05, 0]));

    for (var k = 0; k < 4; k++) {
      var visible = dirs[k][1];
      // a channel built as a ribbon of segments, widening as it runs out
      var segs = 16;
      for (var i = 0; i < segs; i++) {
        var t0 = i / segs, t1 = (i + 1) / segs;
        var a0 = dirs[k][0] + 0.25 * Math.sin(t0 * 9 + k);
        var d0 = 3 + t0 * 70, d1 = 3 + t1 * 70;
        var w = 1.2 + t0 * 3.6;
        var x0 = Math.cos(a0) * d0, z0 = Math.sin(a0) * d0;
        var x1 = Math.cos(a0) * d1, z1 = Math.sin(a0) * d1;
        var len = Math.hypot(x1 - x0, z1 - z0);
        var y = visible ? 0.02 : -t0 * 40;
        var seg = new THREE.BoxGeometry(w, 0.10, len, 2, 1, 2);
        var m = mesh(THREE, seg, M, 'river_' + k + '_' + i,
          [(x0 + x1) / 2, y, (z0 + z1) / 2], [0, -Math.atan2(z1 - z0, x1 - x0) + Math.PI / 2, 0]);
        out.push(m);
      }
    }
    return out;
  }

  /* ---------------- Mecca before dawn ----------------
     A ring of low houses around the Kaaba, with the horizon reading as a rim. The scene was
     empty because the cloud spread 450k samples over a 300-unit plain.                       */
  function dawn(THREE, material) {
    var M = material || mat(THREE);
    var out = [];
    // the Kaaba at the centre, as the sampler places it
    out.push(mesh(THREE, new THREE.BoxGeometry(3.2, 4, 2.8, 2, 4, 2), M, 'dawn_kaaba', [0, 2, 0]));

    // the town: instanced houses on the same ring the sampler uses
    var geo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    var N = 150;
    var inst = new THREE.InstancedMesh(geo, M, N);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(),
        sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (var i = 0; i < N; i++) {
      var a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 52;
      // low courtyard houses, wider than tall, so the town reads as a settlement not a stack
      var w = 2.6 + Math.random() * 3.4, d = 2.4 + Math.random() * 3.0, h = 1.1 + Math.random() * 1.5;
      v.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      q.setFromAxisAngle(up, a + (Math.random() - 0.5) * 0.6);
      sc.set(w, h, d);
      m4.compose(v, q, sc);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.name = 'dawn_town';
    inst.userData.landmark = true;
    inst.frustumCulled = false;
    out.push(inst);
    return out;
  }

  /* ---------------- the Siddiq before the crowd ----------------
     One figure raised before a half-ring of listeners: the scene is about a single person being
     believed, so the crowd has to read as a crowd and he has to stand clear of it.            */
  function vision(THREE, material) {
    var M = material || mat(THREE);
    var out = [];
    // the paved ground and the low platform he stands on
    out.push(mesh(THREE, new THREE.CylinderGeometry(1.5, 1.8, 0.45, 28, 1, true), M, 'vision_dais', [0, 0.22, 0]));

    // the speaker, raised and facing the crowd
    var speaker = mesh(THREE, figureGeometry(THREE), M, 'vision_speaker', [0, 0.45, 0], [0, 0, 0]);
    speaker.scale.setScalar(1.85 / 1.75);
    out.push(speaker);

    // the listeners, on the same half-ring the sampler uses
    var geo = figureGeometry(THREE);
    var N = 240;
    var inst = new THREE.InstancedMesh(geo, M, N);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(),
        sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (var i = 0; i < N; i++) {
      var a = Math.PI + Math.random() * Math.PI;        // the sampler's rn(PI, TAU)
      var r = 10 + Math.random() * 12;
      var x = Math.cos(a) * r * 1.3, z = Math.sin(a) * r;
      v.set(x, 0, z);
      q.setFromAxisAngle(up, Math.atan2(x, z) + Math.PI);   // turned toward the dais
      sc.setScalar((1.55 + Math.random() * 0.3) / 1.75);
      m4.compose(v, q, sc);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.name = 'vision_crowd';
    inst.userData.landmark = true;
    inst.frustumCulled = false;
    out.push(inst);
    return out;
  }

  /* build(sceneId, THREE, material) -> [THREE.Mesh] positioned in that scene's local space.
     Returns [] for a scene with no modelled landmark, so callers can just concat.           */
  function build(sceneId, THREE, material) {
    var f = BUILDERS[sceneId];
    return f ? f(THREE, material) : [];
  }

  function has(sceneId) { return !!BUILDERS[sceneId]; }

  root.Landmarks = { build: build, has: has, material: mat, builders: BUILDERS,
    figureGeometry: figureGeometry, camelGeometry: camelGeometry,
    portico: portico, tawafCrowd: tawafCrowd, camelTrain: camelTrain,
    prophetsHall: prophetsHall, vessels: vessels, rivers: rivers, dawn: dawn, vision: vision };
})(typeof window !== 'undefined' ? window : globalThis);
