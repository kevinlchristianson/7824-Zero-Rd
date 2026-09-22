// Parametric massing model of 7824 Zero Rd.
//
// Units are feet. Axes: +x = east, +y = up, +z = south. Origin is the
// centre of the two-story block's roof outline at grade.
//
// Plan dimensions come from Google Earth (ruler: 82.33 ft across the north
// leg's north roof edge = 251 px, ~0.328 ft/px) cross-checked against the
// listing's overhead drone photo. Roof outlines are what was measured; walls
// sit one overhang inside them.

import * as THREE from 'three';

export const FT_PER_PX = 82.33 / 251;

export const DEFAULTS = {
  pitch: 5 / 12,        // hip roofs, rise per foot of run
  overhang: 1.5,        // eave overhang past the wall face
  roofThick: 0.7,       // fascia depth
  wallT: 1.0,           // brick wall thickness

  // Two-story block on the east side of the U.
  // Wall stack: 11' ground level + 2' floor structure + 9' upper level.
  center: {
    name: 'Center (two-story)',
    roof: { x0: -28.75, x1: 28.75, z0: -38.5, z1: 38.5 },
    ground: 11, floor: 2, upper: 9,
    loggiaDepth: 8,
  },
  // Legs of the U: single-volume, one tall story each.
  // Main block has the center's footprint turned 90 deg (walls 74' E-W x
  // 54'-6" N-S). A vestibule across the west end, behind the four arches,
  // runs out to the measured 82.33' roof edge under the same hip roof.
  north: {
    name: 'North leg',
    roof: { x0: -82.8, x1: -0.5, z0: -88.0, z1: -30.5 },
    wall: 14,
    mainLength: 74,
  },
  south: {
    name: 'South leg (garage)',
    roof: { x0: -62.5, x1: -8.0, z0: 30.5, z1: 79.5 },
    wall: 12,
  },
};

export function wallsOf(roof, overhang) {
  return {
    x0: roof.x0 + overhang, x1: roof.x1 - overhang,
    z0: roof.z0 + overhang, z1: roof.z1 - overhang,
  };
}

export function vestibuleDepth(p = DEFAULTS) {
  const w = wallsOf(p.north.roof, p.overhang);
  return (w.x1 - w.x0) - p.north.mainLength;
}

export function centerPlate(p = DEFAULTS) {
  return p.center.ground + p.center.floor + p.center.upper;
}

// ---------------------------------------------------------------- materials

function makeMaterials() {
  const m = (name, color, extra = {}) =>
    new THREE.MeshStandardMaterial({ name, color, roughness: 0.9, metalness: 0, ...extra });
  return {
    brick: m('brick', 0xe7e0d3),
    band: m('floor_band', 0xd3c7b3),
    roof: m('roof_shingle', 0x5a4640, { flatShading: true }),
    glass: m('glass', 0x2c353b, { roughness: 0.25, metalness: 0.3 }),
    door: m('door', 0x6a5344),
    garage: m('garage_door', 0xefebe4),
    slab: m('floor_slab', 0xc9bfae),
    concrete: m('concrete', 0xbcb7ad),
    steel: m('steel', 0x3b3a38, { roughness: 0.6, metalness: 0.4 }),
    fence: m('fence', 0x6b5040),
    grass: m('dry_grass', 0xc4b58c),
    conifer: m('conifer', 0x3e5838, { flatShading: true }),
    leaf: m('deciduous', 0x76905a, { flatShading: true }),
    olive: m('russian_olive', 0xa6b3a0, { flatShading: true }),
    trunk: m('trunk', 0x5b4636),
  };
}

// ---------------------------------------------------------------- helpers

function mesh(geo, mat, name) {
  const o = new THREE.Mesh(geo, mat);
  o.name = name || mat.name;
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

function box(w, h, d, mat, name) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, name);
}

// Outline of one opening in panel-local coords (x along wall, y up).
// type 'arch': rectangle capped by a semicircle, top = crown height.
function openingPath(o, PathCtor) {
  const p = new PathCtor();
  const l = o.x - o.w / 2, r = o.x + o.w / 2;
  p.moveTo(l, o.sill);
  p.lineTo(r, o.sill);
  if (o.type === 'arch') {
    const spring = o.top - o.w / 2;
    p.lineTo(r, spring);
    p.absarc(o.x, spring, o.w / 2, 0, Math.PI, false);
  } else {
    p.lineTo(r, o.top);
    p.lineTo(l, o.top);
  }
  p.lineTo(l, o.sill);
  return p;
}

// A straight wall panel with openings, built in local coords:
// x: 0..len along the wall (left to right as seen from outside),
// y: y0..y0+h, z: 0..t with the exterior face at z = t.
// Openings whose sill is at the panel base become notches in the outline;
// the rest are holes. Each opening can carry a fill: glass, door, garage.
function wallPanel(len, h, t, openings, mats, y0 = 0) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  const atBase = openings.filter(o => o.sill <= y0 + 1e-6).sort((a, b) => a.x - b.x);
  const holes = openings.filter(o => o.sill > y0 + 1e-6);

  s.moveTo(0, y0);
  for (const o of atBase) {
    const l = o.x - o.w / 2, r = o.x + o.w / 2;
    s.lineTo(l, y0);
    if (o.type === 'arch') {
      const spring = o.top - o.w / 2;
      s.lineTo(l, spring);
      s.absarc(o.x, spring, o.w / 2, Math.PI, 0, true);
    } else {
      s.lineTo(l, o.top);
      s.lineTo(r, o.top);
    }
    s.lineTo(r, y0);
  }
  s.lineTo(len, y0);
  s.lineTo(len, y0 + h);
  s.lineTo(0, y0 + h);
  s.lineTo(0, y0);
  for (const o of holes) s.holes.push(openingPath(o, THREE.Path));

  const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 16 });
  g.add(mesh(geo, mats.brick, 'wall'));

  for (const o of openings) {
    const fill = o.fill || 'glass';
    if (fill === 'open') continue;
    const fs = openingPath({ ...o, sill: o.sill }, THREE.Shape);
    const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.15, bevelEnabled: false, curveSegments: 16 });
    const f = mesh(fg, mats[fill], fill);
    f.position.z = t * 0.35; // set back into the reveal
    g.add(f);
  }
  return g;
}

// Place a panel on one face of a rectangular wall footprint `w`
// (outer faces at x0/x1/z0/z1). N and S panels run the full width;
// E and W panels fit between them. Panel-local x runs left to right as
// seen from outside that face.
function placeWall(face, w, t, h, openings, mats, y0 = 0) {
  const W = w.x1 - w.x0, D = w.z1 - w.z0;
  let panel;
  switch (face) {
    case 'S':
      panel = wallPanel(W, h, t, openings, mats, y0);
      panel.position.set(w.x0, 0, w.z1 - t);
      break;
    case 'N':
      panel = wallPanel(W, h, t, openings, mats, y0);
      panel.rotation.y = Math.PI;
      panel.position.set(w.x1, 0, w.z0 + t);
      break;
    case 'E':
      panel = wallPanel(D - 2 * t, h, t, openings, mats, y0);
      panel.rotation.y = Math.PI / 2;
      panel.position.set(w.x1 - t, 0, w.z1 - t);
      break;
    case 'W':
      panel = wallPanel(D - 2 * t, h, t, openings, mats, y0);
      panel.rotation.y = -Math.PI / 2;
      panel.position.set(w.x0 + t, 0, w.z0 + t);
      break;
  }
  panel.name = `wall_${face}`;
  return panel;
}

// Closed hip-roof solid over rectangle r at eave height eaveY
// (soffit at eaveY, fascia up to eaveY + thick, planes up to the ridge).
export function hipRoof(r, eaveY, pitch, thick, mat) {
  const alongX = (r.x1 - r.x0) >= (r.z1 - r.z0);
  const L = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
  const S = alongX ? r.z1 - r.z0 : r.x1 - r.x0;
  const hL = L / 2, hS = S / 2, rh = hL - hS;
  const top = eaveY + thick, ridge = top + hS * pitch;

  // Local frame: u along the ridge, v across it.
  const P = (u, y, v) => (alongX ? [u, y, v] : [v, y, -u]);
  const A = P(-hL, top, -hS), B = P(hL, top, -hS), C = P(hL, top, hS), Dd = P(-hL, top, hS);
  const a = P(-hL, eaveY, -hS), b = P(hL, eaveY, -hS), c = P(hL, eaveY, hS), d = P(-hL, eaveY, hS);
  const R1 = P(-rh, ridge, 0), R2 = P(rh, ridge, 0);

  const tris = [
    [Dd, C, R2], [Dd, R2, R1],   // +v slope
    [B, A, R1], [B, R1, R2],     // -v slope
    [C, B, R2], [A, Dd, R1],     // hip ends
    [a, b, c], [a, c, d],        // soffit
    [d, c, C], [d, C, Dd], [b, a, A], [b, A, B], // fascia
    [c, b, B], [c, B, C], [a, d, Dd], [a, Dd, A],
  ];
  // (u, v) -> (x, z) is a proper rotation in both cases, so winding holds.
  const pos = [];
  for (const [p0, p1, p2] of tris) pos.push(...p0, ...p1, ...p2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const m = mesh(geo, mat, 'roof');
  m.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
  return m;
}

const arch = (x, w, top, fill = 'glass') => ({ type: 'arch', x, w, sill: 0, top, fill });
const win = (x, sill, w = 3, h = 4.5) => ({ type: 'rect', x, w, sill, top: sill + h, fill: 'glass' });
const door = (x, sill = 0, w = 3.5, h = 7.5) => ({ type: 'rect', x, w, sill, top: sill + h, fill: 'door' });
const ohDoor = (x, w = 10, h = 9) => ({ type: 'rect', x, w, sill: 0, top: h, fill: 'garage' });

// ---------------------------------------------------------------- build

export function buildHouse(p = DEFAULTS, { context = true } = {}) {
  const mats = makeMaterials();
  const t = p.wallT;
  const root = new THREE.Group();
  root.name = '7824_Zero_Rd';
  const walls = new THREE.Group(); walls.name = 'walls';
  const roofs = new THREE.Group(); roofs.name = 'roofs';
  const floors = new THREE.Group(); floors.name = 'floors';
  const site = new THREE.Group(); site.name = 'site';
  root.add(walls, roofs, floors, site);

  // ---- Center: two-story, 11' + 2' + 9'
  const c = p.center;
  const cw = wallsOf(c.roof, p.overhang);
  const plate = c.ground + c.floor + c.upper;
  const upSill = c.ground + c.floor + 3;       // upper-floor window sill
  const cW = cw.x1 - cw.x0, cD = cw.z1 - cw.z0;
  const nw = wallsOf(p.north.roof, p.overhang);
  const sw = wallsOf(p.south.roof, p.overhang);

  // West face = courtyard: open arcade on the ground floor between the legs.
  {
    const zA = nw.z1, zB = sw.z0;                // exposed span between legs
    const n = 6, bay = (zB - zA) / n;
    const ops = [];
    for (let i = 0; i < n; i++) {
      const lx = (zA + bay * (i + 0.5)) - (cw.z0 + t);
      ops.push(arch(lx, 7, c.ground - 1, 'open'));
      ops.push(win(lx, upSill));
    }
    const cc = new THREE.Group(); cc.name = 'center';
    cc.add(placeWall('W', cw, t, plate, ops, mats));

    // Loggia: recessed inner wall behind the arches.
    const lw = { x0: cw.x0 + c.loggiaDepth, x1: cw.x0 + c.loggiaDepth + t + 1, z0: zA, z1: zB };
    const L = zB - zA, m = L / 2;
    cc.add(placeWall('W', { ...lw, z0: zA - t, z1: zB + t }, t, c.ground,
      [win(m - 20, 3, 4, 5), door(m - 8), door(m + 8), win(m + 20, 3, 4, 5)], mats));
    const lf = box(c.loggiaDepth, 0.3, L, mats.concrete, 'loggia_floor');
    lf.position.set(cw.x0 + c.loggiaDepth / 2, 0.15, (zA + zB) / 2);
    cc.add(lf);

    // East face: windows on both levels, upper door to the exterior stair.
    const eOps = [];
    for (const lx of [6, 17, 28, 46, 57, 68]) eOps.push(win(lx, 3, 3, 5));
    eOps.push(door(37));
    for (const lx of [6, 17, 28, 39, 50, 61]) eOps.push(win(lx, upSill));
    eOps.push(door(cD - 2 * t - 3.5, c.ground + c.floor, 3, 7));
    cc.add(placeWall('E', cw, t, plate, eOps, mats));

    // North face: exposed east of the north leg.
    cc.add(placeWall('N', cw, t, plate,
      [win(8, 3, 3, 5), win(20, 3, 3, 5), win(8, upSill), win(20, upSill)], mats));

    // South face: exposed east of the south leg.
    cc.add(placeWall('S', cw, t, plate,
      [win(cW - 22, 3, 3, 5), door(cW - 10), win(cW - 22, upSill), win(cW - 10, upSill)], mats));

    // Exterior floor band marking the 2' floor structure.
    const band = new THREE.Group(); band.name = 'floor_band';
    const bh = c.floor, by = c.ground + bh / 2, pr = 0.12;
    const bS = box(cW + 2 * pr, bh, pr, mats.band); bS.position.set(0 + (cw.x0 + cw.x1) / 2, by, cw.z1 + pr / 2);
    const bN = bS.clone(); bN.position.z = cw.z0 - pr / 2;
    const bE = box(pr, bh, cD, mats.band); bE.position.set(cw.x1 + pr / 2, by, (cw.z0 + cw.z1) / 2);
    const bW = bE.clone(); bW.position.x = cw.x0 - pr / 2;
    band.add(bS, bN, bE, bW);
    cc.add(band);
    walls.add(cc);

    // Floor structure between levels (the 2' stack), full footprint.
    const slab = box(cW - 2 * t, c.floor, cD - 2 * t, mats.slab, 'floor_structure');
    slab.position.set((cw.x0 + cw.x1) / 2, c.ground + c.floor / 2, (cw.z0 + cw.z1) / 2);
    floors.add(slab);

    // Exterior steel stair up the east face to the upper-level door.
    const stair = new THREE.Group(); stair.name = 'exterior_stair';
    const rise = c.ground + c.floor, nR = 20, rH = rise / nR, run = 0.9, sW = 3.5;
    const sx = cw.x1 + sW / 2;
    const landZ0 = cw.z0 + 0.5, landZ1 = landZ0 + 5;
    const land = box(sW, 0.3, landZ1 - landZ0, mats.steel, 'landing');
    land.position.set(sx, rise - 0.15, (landZ0 + landZ1) / 2);
    stair.add(land);
    for (const pz of [landZ0 + 0.2, landZ1 - 0.2]) {
      const post = box(0.3, rise, 0.3, mats.steel, 'post');
      post.position.set(cw.x1 + sW - 0.2, rise / 2, pz);
      stair.add(post);
    }
    for (let i = 1; i < nR; i++) {
      const tr = box(sW, 0.15, run + 0.1, mats.steel, 'tread');
      tr.position.set(sx, i * rH - 0.075, landZ1 + (nR - i - 0.5) * run);
      stair.add(tr);
    }
    const flightLen = (nR - 1) * run, slope = Math.atan2(rise, flightLen + run);
    const hyp = Math.hypot(rise, flightLen + run);
    for (const [ox, h] of [[cw.x1 + 0.1, 0], [cw.x1 + sW - 0.1, 0], [cw.x1 + sW - 0.1, 3]]) {
      const s = box(0.2, h ? 0.15 : 0.9, hyp, mats.steel, h ? 'handrail' : 'stringer');
      s.position.set(ox, rise / 2 + h - (h ? 0 : 0.4), landZ1 + (flightLen + run) / 2);
      s.rotation.x = slope;
      stair.add(s);
    }
    const lr = box(0.15, 0.15, landZ1 - landZ0, mats.steel, 'handrail');
    lr.position.set(cw.x1 + sW - 0.1, rise + 3, (landZ0 + landZ1) / 2);
    stair.add(lr);
    walls.add(stair);

    roofs.add(hipRoof(c.roof, plate, p.pitch, p.roofThick, mats.roof));
  }

  // ---- North leg: single volume
  {
    const L = p.north, w = nw, h = L.wall;
    const g = new THREE.Group(); g.name = 'north_leg';
    const D = w.z1 - w.z0 - 2 * t, bay = D / 4;
    const vest = vestibuleDepth(p);
    g.add(placeWall('W', w, t, h, [0, 1, 2, 3].map(i => arch(bay * (i + 0.5), 8, 10.5)), mats));
    // West wall of the main block = back wall of the vestibule.
    const iw = { x0: w.x0 + vest, x1: w.x0 + vest + 2 * t, z0: w.z0, z1: w.z1 };
    g.add(placeWall('W', iw, t, h, [door(D / 2 - 12, 0, 6, 8), door(D / 2 + 12, 0, 6, 8)], mats));
    g.add(placeWall('S', w, t, h, [win(vest / 2, 4, 2.5, 5), win(18, 4, 4, 5), win(32, 4, 4, 5), door(46)], mats));
    g.add(placeWall('N', w, t, h, [20, 40, 60].map(x => win(x, 8, 4, 3)), mats));
    g.add(placeWall('E', w, t, h, [door(12), win(30, 4, 4, 5)], mats));
    walls.add(g);
    roofs.add(hipRoof(L.roof, h, p.pitch, p.roofThick, mats.roof));
  }

  // ---- South leg: single volume, overhead doors onto the drive
  {
    const L = p.south, w = sw, h = L.wall;
    const g = new THREE.Group(); g.name = 'south_leg';
    g.add(placeWall('S', w, t, h, [ohDoor(15), ohDoor(33), door(45)], mats));
    g.add(placeWall('W', w, t, h, [win(22, 4, 4, 4)], mats));
    g.add(placeWall('N', w, t, h, [door(28), win(40, 4, 4, 5)], mats));
    g.add(placeWall('E', w, t, h, [win(10, 4, 4, 4), win(25, 4, 4, 4)], mats));
    walls.add(g);
    roofs.add(hipRoof(L.roof, h, p.pitch, p.roofThick, mats.roof));
  }

  // ---- Site context (approximate, from aerials)
  if (context) {
    const ground = mesh(new THREE.PlaneGeometry(700, 700), mats.grass, 'ground');
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.castShadow = false;
    site.add(ground);

    const pad = (x0, x1, z0, z1, name) => {
      const b = box(x1 - x0, 0.3, z1 - z0, mats.concrete, name);
      b.position.set((x0 + x1) / 2, 0.15, (z0 + z1) / 2);
      b.castShadow = false;
      site.add(b);
    };
    pad(-56, -8, sw.z1, sw.z1 + 40, 'driveway_apron');
    pad(cw.x1, 71, 38, 52, 'east_slab');

    // Picket fence enclosing the yard north of the center block.
    const fz0 = -62, fx1 = 11, fh = 4.5;
    const fN = box(fx1 - nw.x1, fh, 0.25, mats.fence, 'fence');
    fN.position.set((nw.x1 + fx1) / 2, fh / 2, fz0);
    const fE = box(0.25, fh, cw.z0 - fz0, mats.fence, 'fence');
    fE.position.set(fx1, fh / 2, (fz0 + cw.z0) / 2);
    site.add(fN, fE);

    const trees = new THREE.Group(); trees.name = 'trees';
    const conifer = (x, z, h) => {
      const g = new THREE.Group();
      const tr = mesh(new THREE.CylinderGeometry(0.5, 0.7, h * 0.2, 6), mats.trunk);
      tr.position.y = h * 0.1;
      const cone = mesh(new THREE.ConeGeometry(h * 0.22, h * 0.85, 8), mats.conifer);
      cone.position.y = h * 0.15 + h * 0.425;
      g.add(tr, cone);
      g.position.set(x, 0, z);
      trees.add(g);
    };
    const leafy = (x, z, r, mat = mats.leaf) => {
      const g = new THREE.Group();
      const tr = mesh(new THREE.CylinderGeometry(0.6, 0.9, r * 1.2, 6), mats.trunk);
      tr.position.y = r * 0.6;
      const crown = mesh(new THREE.IcosahedronGeometry(r, 1), mat);
      crown.position.y = r * 1.6;
      crown.scale.y = 0.8;
      g.add(tr, crown);
      g.position.set(x, 0, z);
      trees.add(g);
    };
    conifer(34, -44, 36);
    conifer(-93, -68, 26); conifer(-102, -45, 22); conifer(-129, 70, 24);
    conifer(-112, 47, 20); conifer(-4, 88, 22); conifer(12, 70, 26);
    conifer(24, 96, 20); conifer(-84, 4, 18);
    leafy(-50, -8, 5);
    leafy(45, 4, 11, mats.olive); leafy(40, -24, 9);
    leafy(-38, 104, 8, mats.olive); leafy(58, 30, 10, mats.olive);
    site.add(trees);
  }

  return root;
}

// Plan and height summary, for display.
export function summary(p = DEFAULTS) {
  const out = [];
  const add = (key, v, heights) => {
    const w = wallsOf(v.roof, p.overhang);
    out.push({
      key, name: v.name,
      ew: w.x1 - w.x0, ns: w.z1 - w.z0,
      roofEW: v.roof.x1 - v.roof.x0, roofNS: v.roof.z1 - v.roof.z0,
      heights,
    });
  };
  add('center', p.center, [
    ['Ground level', p.center.ground],
    ['Floor structure', p.center.floor],
    ['Upper level', p.center.upper],
  ]);
  add('north', p.north, [['Wall, one volume', p.north.wall]]);
  {
    const w = wallsOf(p.north.roof, p.overhang);
    out.at(-1).parts = [
      ['Main block (center footprint)', p.north.mainLength, w.z1 - w.z0],
      ['West vestibule', vestibuleDepth(p), w.z1 - w.z0],
    ];
  }
  add('south', p.south, [['Wall, one volume', p.south.wall]]);
  return out;
}
