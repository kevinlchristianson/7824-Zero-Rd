// Parametric massing model of 7824 Zero Rd (three.js).
// Geometry inputs and the opening inventory live in params.js, shared with
// the heating and cooling model.

import * as THREE from 'three';
import { DEFAULTS, wallsOf, vestibuleDepth, centerPlate, gableOf, openings } from './params.js';

export { DEFAULTS, FT_PER_PX, wallsOf, vestibuleDepth, centerPlate, gableOf, openings } from './params.js';

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
    pv: m('pv_panel', 0x1f2a3c, { roughness: 0.35, metalness: 0.25 }),
    pvShaded: m('pv_shaded', 0xc4553a, { transparent: true, opacity: 0.55 }),
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

// Gable roof over block `key` ('center', 'north' or 'south'): a slab `thick`
// deep, two slopes meeting at a ridge along x or z, overhanging the walls at
// the eaves and rakes. Returns the roof and the two brick gable ends, which
// fill the wall from the plate up to the underside of the roof.
export function gableRoof(p, key, mats) {
  const r = p[key].roof, w = wallsOf(r, p.overhang), g = gableOf(p, key);
  const t = p.roofThick, k = p.pitch, hS = g.half, e = g.plate, top = g.eaveTop, ridge = g.ridgeY;
  const hL = (g.alongX ? r.x1 - r.x0 : r.z1 - r.z0) / 2;

  // Local frame: u along the ridge, v across it.
  const P = (u, y, v) => (g.alongX ? [u, y, v] : [v, y, -u]);
  const A = P(-hL, top, -hS), B = P(hL, top, -hS), C = P(hL, top, hS), D = P(-hL, top, hS);
  const a = P(-hL, e, -hS), b = P(hL, e, -hS), c = P(hL, e, hS), d = P(-hL, e, hS);
  const R1 = P(-hL, ridge, 0), R2 = P(hL, ridge, 0), r1 = P(-hL, ridge - t, 0), r2 = P(hL, ridge - t, 0);

  const tris = [
    [D, C, R2], [D, R2, R1], [B, A, R1], [B, R1, R2],   // slopes
    [d, r2, c], [d, r1, r2], [b, r1, a], [b, r2, r1],   // soffits
    [d, c, C], [d, C, D], [b, a, A], [b, A, B],         // fascia
    [a, R1, A], [a, r1, R1], [r1, D, R1], [r1, d, D],   // rakes
    [b, B, R2], [b, R2, r2], [r2, R2, C], [r2, C, c],
  ];
  // (u, v) -> (x, z) is a proper rotation in both cases, so winding holds.
  const pos = [];
  for (const [p0, p1, p2] of tris) pos.push(...p0, ...p1, ...p2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const roof = mesh(geo, mats.roof, 'roof');
  roof.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);

  // Gable ends: a pentagon across the wall, extruded inward one wall thick.
  const hW = hS - p.overhang, s = new THREE.Shape();
  s.moveTo(-hW, e); s.lineTo(hW, e); s.lineTo(hW, e + k * p.overhang);
  s.lineTo(0, e + k * hS); s.lineTo(-hW, e + k * p.overhang); s.lineTo(-hW, e);
  const endGeo = new THREE.ExtrudeGeometry(s, { depth: p.wallT, bevelEnabled: false });
  const ends = (g.alongX
    ? [[w.x0, g.mid, Math.PI / 2], [w.x1, g.mid, -Math.PI / 2]]
    : [[g.mid, w.z0, 0], [g.mid, w.z1, Math.PI]]
  ).map(([x, z, ry]) => {
    const m = mesh(endGeo, mats.brick, 'gable');
    m.position.set(x, 0, z);
    m.rotation.y = ry;
    return m;
  });
  return { roof, ends };
}

// Solar panels from a roof layout (data/roofpv.json, npm run roofpv), on the
// south slopes: dark where they pay, pale red where shade leaves a spot out.
export function pvPanels(layout, mats = makeMaterials()) {
  const g = new THREE.Group(); g.name = 'pv';
  const standoff = 0.4, thick = 0.13;
  for (const sl of layout.slopes) {
    if (!sl.south) continue;
    const n = sl.normal, lift = standoff + thick / 2;
    for (const q of sl.panels) {
      // Box y along the slope normal, z down the slope (a south slope).
      const b = box(sl.w - 0.02, thick, sl.l - 0.02, q.kept ? mats.pv : mats.pvShaded, q.kept ? 'pv_panel' : 'pv_shaded');
      b.position.set(q.c[0] + n[0] * lift, q.c[1] + n[1] * lift, q.c[2] + n[2] * lift);
      b.rotation.x = sl.tilt;
      g.add(b);
    }
  }
  return g;
}

const FILL = { window: 'glass', glassDoor: 'glass', arch: 'glass', door: 'door', garageDoor: 'garage', open: 'open' };

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
  const plate = centerPlate(p);
  const floor2 = c.ground + c.floor;
  const cW = cw.x1 - cw.x0, cD = cw.z1 - cw.z0;
  const nw = wallsOf(p.north.roof, p.overhang);
  const sw = wallsOf(p.south.roof, p.overhang);
  const ops = openings(p);
  const on = panel => ops.filter(o => o.panel === panel).map(o => ({ ...o, fill: FILL[o.kind] }));

  // West face = courtyard: open arcade on the ground floor between the legs.
  {
    const zA = nw.z1, zB = sw.z0;                // exposed span between legs
    const cc = new THREE.Group(); cc.name = 'center';
    cc.add(placeWall('W', cw, t, plate, on('center.W'), mats));

    // Porch: the arcade stands porchDepth out from the west wall, between
    // the legs, and carries an open deck along the upper level.
    const pd = c.porchDepth, at = c.arcadeT, L = zB - zA, px = cw.x0 - pd;
    const porch = new THREE.Group(); porch.name = 'porch';
    porch.add(placeWall('W', { x0: px, x1: px + at, z0: zA - at, z1: zB + at }, at, floor2, on('porch.W'), mats));
    const pf = box(pd, 0.3, L, mats.concrete, 'porch_floor');
    pf.position.set(px + pd / 2, 0.15, (zA + zB) / 2);
    const dk = box(pd, 1, L, mats.concrete, 'deck');
    dk.position.set(px + pd / 2, floor2 - 0.5, (zA + zB) / 2);
    const dr = box(0.15, 0.15, L, mats.steel, 'deck_rail');
    dr.position.set(px + 0.1, floor2 + 3.5, (zA + zB) / 2);
    porch.add(pf, dk, dr);
    for (let i = 0; i <= 6; i++) {
      const post = box(0.2, 3.5, 0.2, mats.steel, 'rail_post');
      post.position.set(px + 0.1, floor2 + 1.75, zA + 0.2 + (L - 0.4) * i / 6);
      porch.add(post);
    }
    cc.add(porch);

    // East, north and south faces. The upper east door opens onto the
    // exterior stair; the 72" north door onto a small balcony.
    cc.add(placeWall('E', cw, t, plate, on('center.E'), mats));
    cc.add(placeWall('N', cw, t, plate, on('center.N'), mats));
    cc.add(placeWall('S', cw, t, plate, on('center.S'), mats));

    const slider = ops.find(o => o.panel === 'center.N' && o.kind === 'glassDoor');
    if (slider) {
      const bal = new THREE.Group(); bal.name = 'balcony';
      const bw = slider.w + 2, bd = 4, bx = cw.x1 - slider.x, bz = cw.z0 - bd / 2;
      const deck = box(bw, 0.3, bd, mats.steel, 'balcony_deck');
      deck.position.set(bx, floor2 - 0.15, bz);
      bal.add(deck);
      const rail = (w, d, x, z) => {
        const r = box(w, 0.15, d, mats.steel, 'handrail');
        r.position.set(x, floor2 + 3.5, z);
        bal.add(r);
      };
      rail(bw, 0.15, bx, cw.z0 - bd);
      rail(0.15, bd, bx - bw / 2, bz);
      rail(0.15, bd, bx + bw / 2, bz);
      for (const sx of [-1, 1]) {
        const post = box(0.3, floor2 + 3.5, 0.3, mats.steel, 'post');
        post.position.set(bx + sx * (bw / 2 - 0.15), (floor2 + 3.5) / 2, cw.z0 - bd + 0.15);
        bal.add(post);
      }
      walls.add(bal);
    }

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

    const { roof, ends } = gableRoof(p, 'center', mats);
    roofs.add(roof); cc.add(...ends);
  }

  // ---- North leg: single volume
  {
    const L = p.north, w = nw, h = L.wall;
    const g = new THREE.Group(); g.name = 'north_leg';
    const vest = vestibuleDepth(p);
    g.add(placeWall('W', w, t, h, on('north.W'), mats));
    // West wall of the main block = back wall of the vestibule.
    const iw = { x0: w.x0 + vest, x1: w.x0 + vest + 2 * t, z0: w.z0, z1: w.z1 };
    g.add(placeWall('W', iw, t, h, on('north.inner'), mats));
    g.add(placeWall('S', w, t, h, on('north.S'), mats));
    g.add(placeWall('N', w, t, h, on('north.N'), mats));
    g.add(placeWall('E', w, t, h, on('north.E'), mats));
    const { roof, ends } = gableRoof(p, 'north', mats);
    g.add(...ends);
    walls.add(g);
    roofs.add(roof);
  }

  // ---- South leg: single volume, overhead doors onto the drive
  {
    const L = p.south, w = sw, h = L.wall;
    const g = new THREE.Group(); g.name = 'south_leg';
    for (const f of ['S', 'W', 'N', 'E']) g.add(placeWall(f, w, t, h, on(`south.${f}`), mats));
    const { roof, ends } = gableRoof(p, 'south', mats);
    g.add(...ends);
    walls.add(g);
    roofs.add(roof);
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
