// Geometry inputs for 7824 Zero Rd, shared by the 3D model (building.js)
// and the heating and cooling model (thermal.js). No three.js here.
//
// Units are feet. Axes: +x = east, +y = up, +z = south. Origin is the
// centre of the two-story block's roof outline at grade.
//
// Plan dimensions come from Google Earth (ruler: 82.33 ft across the north
// leg's north roof edge = 251 px, ~0.328 ft/px) cross-checked against the
// listing's overhead drone photo. Roof outlines are what was measured; walls
// sit one overhang inside them.

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

  // Upper-level openings as given by the owner: sixteen 41" x 67" windows,
  // one 36" door and one 72" door (80" tall assumed).
  upperWindow: { w: 41 / 12, h: 67 / 12, sillAboveFloor: 2.5 },
  upperDoors: [{ w: 36 / 12, h: 80 / 12 }, { w: 72 / 12, h: 80 / 12 }],
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

// ---------------------------------------------------------------- openings
//
// Every door, window and arch, as data. Each entry names:
//   panel  the wall it sits in (see panelSpecs); x runs along that panel,
//          left to right as seen from outside, from its inside corner
//   zone   the thermal zone it serves: shop, vest, ground, upper, garage,
//          or loggia for the open arcade (no thermal element)
//   face   compass direction it faces
//   kind   window | glassDoor | door | garageDoor | arch | open
//   to     the space on the other side when that is another zone
// Only the upper-level set is from the owner. The rest are read off the
// listing photos and are placeholders until confirmed.

const rect = (x, sill, w, h) => ({ type: 'rect', x, w, sill, top: sill + h });
const archAt = (x, w, top) => ({ type: 'arch', x, w, sill: 0, top });

export function openings(p = DEFAULTS) {
  const t = p.wallT, c = p.center;
  const cw = wallsOf(c.roof, p.overhang);
  const nw = wallsOf(p.north.roof, p.overhang);
  const sw = wallsOf(p.south.roof, p.overhang);
  const cW = cw.x1 - cw.x0, cD = cw.z1 - cw.z0;
  const floor2 = c.ground + c.floor;
  const uw = p.upperWindow, uSill = floor2 + uw.sillAboveFloor;
  const [d36, d72] = p.upperDoors;
  const list = [];
  const add = (panel, zone, face, kind, o, extra = {}) =>
    list.push({ panel, zone, face, kind, ...o, ...extra });
  const upWin = (panel, face, x) => add(panel, 'upper', face, 'window', rect(x, uSill, uw.w, uw.h));

  // Center, west (courtyard) face: open arcade, one upper window over each arch.
  const zA = nw.z1, zB = sw.z0, bay = (zB - zA) / 6;
  for (let i = 0; i < 6; i++) {
    const x = zA + bay * (i + 0.5) - (cw.z0 + t);
    add('center.W', 'loggia', 'W', 'open', archAt(x, 7, c.ground - 1));
    upWin('center.W', 'W', x);
  }
  // Loggia back wall: the ground level's courtyard face, under the upper floor.
  const m = (zB - zA) / 2;
  add('loggia.W', 'ground', 'W', 'window', rect(m - 20, 3, 4, 5));
  add('loggia.W', 'ground', 'W', 'door', rect(m - 8, 0, 3, 7));
  add('loggia.W', 'ground', 'W', 'door', rect(m + 8, 0, 3, 7));
  add('loggia.W', 'ground', 'W', 'window', rect(m + 20, 3, 4, 5));

  // Center, east face. Upper door opens onto the exterior stair landing.
  for (const x of [6, 17, 28, 46, 57, 68]) add('center.E', 'ground', 'E', 'window', rect(x, 3, 3, 5));
  add('center.E', 'ground', 'E', 'door', rect(37, 0, 3, 7));
  for (const x of [6, 17, 28, 39, 50, 61]) upWin('center.E', 'E', x);
  add('center.E', 'upper', 'E', 'door', rect(cD - 2 * t - 3.5, floor2, d36.w, d36.h));

  // Center, north face (exposed east of the north leg). The 72" door is a
  // glazed slider onto a small balcony.
  for (const x of [6, 22]) add('center.N', 'ground', 'N', 'window', rect(x, 3, 3, 5));
  for (const x of [6, 22]) upWin('center.N', 'N', x);
  add('center.N', 'upper', 'N', 'glassDoor', rect(14, floor2, d72.w, d72.h));

  // Center, south face (exposed east of the south leg).
  add('center.S', 'ground', 'S', 'window', rect(cW - 22, 3, 3, 5));
  add('center.S', 'ground', 'S', 'door', rect(cW - 10, 0, 3, 7));
  for (const x of [cW - 22, cW - 10]) upWin('center.S', 'S', x);

  // North leg: four glazed arches across the vestibule front.
  const nD = nw.z1 - nw.z0 - 2 * t, vest = vestibuleDepth(p);
  for (let i = 0; i < 4; i++) add('north.W', 'vest', 'W', 'arch', archAt(nD / 4 * (i + 0.5), 8, 10.5));
  // Shop's west wall = back of the vestibule: two pairs of doors.
  add('north.inner', 'shop', 'W', 'door', rect(nD / 2 - 12, 0, 6, 8), { to: 'vest' });
  add('north.inner', 'shop', 'W', 'door', rect(nD / 2 + 12, 0, 6, 8), { to: 'vest' });
  add('north.S', 'vest', 'S', 'window', rect(vest / 2, 4, 2.5, 5));
  add('north.S', 'shop', 'S', 'window', rect(18, 4, 4, 5));
  add('north.S', 'shop', 'S', 'window', rect(32, 4, 4, 5));
  add('north.S', 'shop', 'S', 'door', rect(46, 0, 3, 7));
  for (const x of [20, 40, 60]) add('north.N', 'shop', 'N', 'window', rect(x, 8, 4, 3));
  add('north.E', 'shop', 'E', 'door', rect(12, 0, 3, 7));
  add('north.E', 'shop', 'E', 'window', rect(30, 4, 4, 5));

  // South leg (garage): overhead doors onto the drive.
  add('south.S', 'garage', 'S', 'garageDoor', rect(15, 0, 10, 9));
  add('south.S', 'garage', 'S', 'garageDoor', rect(33, 0, 10, 9));
  add('south.S', 'garage', 'S', 'door', rect(45, 0, 3, 7));
  add('south.W', 'garage', 'W', 'window', rect(22, 4, 4, 4));
  add('south.N', 'garage', 'N', 'door', rect(28, 0, 3, 7));
  add('south.N', 'garage', 'N', 'window', rect(40, 4, 4, 5));
  add('south.E', 'garage', 'E', 'window', rect(10, 4, 4, 4));
  add('south.E', 'garage', 'E', 'window', rect(25, 4, 4, 4));

  return list;
}

export function openingArea(o) {
  if (o.type === 'arch') {
    const r = o.w / 2;
    return o.w * (o.top - o.sill - r) + Math.PI * r * r / 2;
  }
  return o.w * (o.top - o.sill);
}
