// Geometry inputs for 7824 Zero Rd, shared by the 3D model (building.js)
// and the heating and cooling model (thermal.js). No three.js here.
//
// Units are feet. Axes: +x = east, +y = up, +z = south. Origin is the
// centre of the two-story block's roof outline at grade.
//
// Plan positions come from Google Earth (ruler: 82.33 ft across the north
// leg's north roof edge = 251 px, ~0.328 ft/px); the two big blocks use the
// owner's 48' x 68' inside dimensions.

export const FT_PER_PX = 82.33 / 251;

// The owner's inside dimensions: the center block and the shop are each
// 48' x 68' inside, 12" brick plus foam (about 16") all round. The buildings
// are plain rectangles that butt together; the insets seen from above are
// the eaves overlapping.
const WALL = 16 / 12;
const IN_W = 48, IN_D = 68;
const EXT_W = IN_W + 2 * WALL, EXT_D = IN_D + 2 * WALL;   // 50'-8" x 70'-8"

// Wall footprints (outer faces). Center sits on the origin; the shop's south
// wall is the center's north wall line, its east end at the measured roof
// edge; the vestibule runs west to the measured 82.33' roof line; the south
// leg's north wall is the center's south wall line.
const OVERHANG = 1.5;
const W = {
  center: { x0: -EXT_W / 2, x1: EXT_W / 2, z0: -EXT_D / 2, z1: EXT_D / 2 },
  north: { x0: -82.8 + OVERHANG, x1: -0.5 - OVERHANG, z0: -EXT_D / 2 - EXT_W, z1: -EXT_D / 2 },
  south: { x0: -61, x1: -9.5, z0: EXT_D / 2, z1: EXT_D / 2 + 46 },
};
const roofOf = w => ({ x0: w.x0 - OVERHANG, x1: w.x1 + OVERHANG, z0: w.z0 - OVERHANG, z1: w.z1 + OVERHANG });

export const DEFAULTS = {
  pitch: 5 / 12,        // hip roofs, rise per foot of run
  overhang: OVERHANG,   // eave overhang past the wall face
  roofThick: 0.7,       // fascia depth
  wallT: WALL,          // brick + foam wall thickness
  insideW: IN_W, insideD: IN_D,

  // Two-story block on the east side of the U.
  // Wall stack: 11' ground level + 2' floor structure + 9' upper level.
  center: {
    name: 'Center (two-story)',
    roof: roofOf(W.center),
    ground: 11, floor: 2, upper: 9,
    loggiaDepth: 8,
  },
  // Legs of the U: single-volume, one tall story each. The north leg's main
  // block (the shop) is the center's footprint turned 90 deg; a vestibule
  // across its west end, behind the four arches, runs to the measured roof.
  north: {
    name: 'North leg',
    roof: roofOf(W.north),
    wall: 14,
    mainLength: EXT_D,
  },
  south: {
    name: 'South leg (garage)',
    roof: roofOf(W.south),
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
// Upper level, ground level and shop openings are as the owner described;
// exact positions and the vestibule and south-leg openings are read off the
// listing photos.

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
  // Ground level (owner): no windows; a 36" walkout to the courtyard through
  // the loggia, and 86" walkthroughs into the shop and the south leg.
  const m = (zB - zA) / 2, d86 = { w: 86 / 12, h: 80 / 12 };
  add('loggia.W', 'ground', 'W', 'door', rect(m, 0, d36.w, d36.h));
  add('center.N', 'ground', 'N', 'door', rect(cw.x1 - (cw.x0 + nw.x1) / 2, 0, d86.w, d86.h), { to: 'shop' });
  add('center.S', 'ground', 'S', 'door', rect((sw.x1 - cw.x0) / 2, 0, d86.w, d86.h), { to: 'garage' });

  // Center, east face: upper windows; upper door opens onto the exterior stair.
  for (const x of [6, 17, 28, 39, 50, 61]) upWin('center.E', 'E', x);
  add('center.E', 'upper', 'E', 'door', rect(cD - 2 * t - 3.5, floor2, d36.w, d36.h));

  // Center, north face (exposed east of the north leg). The 72" door is a
  // glazed slider onto a small balcony.
  for (const x of [6, 22]) upWin('center.N', 'N', x);
  add('center.N', 'upper', 'N', 'glassDoor', rect(14, floor2, d72.w, d72.h));

  // Center, south face (exposed east of the south leg).
  for (const x of [cW - 22, cW - 10]) upWin('center.S', 'S', x);

  // North leg: four glazed arches across the vestibule front.
  const nD = nw.z1 - nw.z0 - 2 * t, vest = vestibuleDepth(p);
  for (let i = 0; i < 4; i++) add('north.W', 'vest', 'W', 'arch', archAt(nD / 4 * (i + 0.5), 8, 10.5));
  add('north.S', 'vest', 'S', 'window', rect(vest / 2, 4, 2.5, 5));
  // Shop (owner): super airtight, no windows, no doors on the prevailing
  // (west/south-west) wind side. One door on the lee side, placement assumed.
  add('north.E', 'shop', 'E', 'door', rect(12, 0, 3, 7));

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
