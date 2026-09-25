// Solar panels on the roof slopes of 7824 Zero Rd, and how much sun each one
// loses to the other buildings, hour by hour on the Casper TMY3 year. The
// owner's plan is on the south slopes (only a gable whose ridge runs east-west
// has one); the max fit fills every slope that doesn't face north, which
// brings in the center block's east and west slopes. Trees are left out
// (owner). Diffuse light is taken as unshaded.

import { DEFAULTS, wallsOf, gableOf } from './params.js';
import { pvPerKw, SOLAR_INPUTS } from './solar.js';

export const ROOFPV_INPUTS = {
  panel: { watts: 440, longIn: 1722 / 25.4, shortIn: 1134 / 25.4 },   // ZnShine ZXM7-UHLDD108 440 W bifacial, two pallets of 36 (owner); 1722 x 1134 mm
  gapIn: 0.5,        // between panels (IronRidge UFO clamps)
  edgeFt: 1,         // clear of the eaves and gable ends
  ridgeFt: 1.5,      // off the ridge: the fire-code setback while panels cover under a third of the roof
  ridgeFtOver: 3,    // the setback once they cover more than a third (IRC R324.6.2)
  maxLoss: 0.10,     // a spot pays when shade costs it at most this share of its sun
  // The owner's arrays: panels per row from the eave up, landscape, from the
  // west end. The shop has 72: the owner's IronRidge layout (57 panels, rows
  // of 10, 10, 9, 8, 7, 7, 6 from the ridge down) carried east as far as shade
  // allows. The garage has none yet. A roof not listed gets every spot that pays.
  rows: { north: [7, 8, 9, 10, 11, 13, 14], south: [] },
};

const KEYS = ['center', 'north', 'south'];
const sum = a => a.reduce((x, y) => x + y, 0);

// Each block as two convex solids, its walls and its roof, each a list of
// half-spaces [nx, ny, nz, c] meaning n.x <= c.
function solidsOf(p) {
  const out = [];
  for (const key of KEYS) {
    const r = p[key].roof, w = wallsOf(r, p.overhang), g = gableOf(p, key), k = p.pitch;
    out.push({ key, hs: [[-1, 0, 0, -w.x0], [1, 0, 0, w.x1], [0, -1, 0, 0], [0, 1, 0, g.plate], [0, 0, -1, -w.z0], [0, 0, 1, w.z1]] });
    // Inside the roof outline, above the plate, under both slopes:
    // y + k |s - mid| <= ridgeY, with s across the ridge.
    const hs = [[-1, 0, 0, -r.x0], [1, 0, 0, r.x1], [0, 0, -1, -r.z0], [0, 0, 1, r.z1], [0, -1, 0, -g.plate]];
    if (g.alongX) hs.push([0, 1, k, g.ridgeY + k * g.mid], [0, 1, -k, g.ridgeY - k * g.mid]);
    else hs.push([k, 1, 0, g.ridgeY + k * g.mid], [-k, 1, 0, g.ridgeY - k * g.mid]);
    out.push({ key, hs });
  }
  return out;
}

// Does the ray p0 + t d, t > 0, pass through the solid?
function hits(p0, d, hs) {
  let t0 = 1e-6, t1 = Infinity;
  for (const [nx, ny, nz, c] of hs) {
    const den = nx * d[0] + ny * d[1] + nz * d[2], num = c - (nx * p0[0] + ny * p0[1] + nz * p0[2]);
    if (Math.abs(den) < 1e-12) { if (num < 0) return false; continue; }
    const t = num / den;
    if (den > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
    if (t0 > t1) return false;
  }
  return true;
}

const inside = (pt, hs) => hs.every(([nx, ny, nz, c]) => nx * pt[0] + ny * pt[1] + nz * pt[2] < c - 1e-6);

// The slopes of a block that don't face north: the south slope of a gable
// whose ridge runs east-west, both slopes of one whose ridge runs north-south.
// u runs along the eave (west to east, or north to south) and w up the slope
// from the outer eave edge; at(u, w) is the roof surface point there.
function slopesOf(p, key) {
  const g = gableOf(p, key), r = p[key].roof, k = p.pitch, sec = Math.hypot(1, k);
  const y = w => g.eaveTop + k * w / sec, base = { key, length: g.half * sec, tilt: Math.atan(k) };
  if (g.alongX) return [{ ...base, face: 'S', azimuth: 180, u0: r.x0, u1: r.x1, normal: [0, 1 / sec, k / sec], at: (u, w) => [u, y(w), r.z1 - w / sec] }];
  return [
    { ...base, face: 'E', azimuth: 90, u0: r.z0, u1: r.z1, normal: [k / sec, 1 / sec, 0], at: (u, w) => [r.x1 - w / sec, y(w), u] },
    { ...base, face: 'W', azimuth: 270, u0: r.z0, u1: r.z1, normal: [-k / sec, 1 / sec, 0], at: (u, w) => [r.x0 + w / sec, y(w), u] },
  ];
}

// Daylight hours: sun direction (+x east, +y up, +z south; azimuth is
// clockwise from north) and irradiance.
function sunHours(wx) {
  const out = [];
  for (let i = 0; i < wx.n; i++) {
    if (wx.GHI[i] <= 0) continue;
    const alt = wx.alt[i], az = wx.az[i];
    out.push({ dni: wx.DNI[i], dhi: wx.DHI[i], ghi: wx.GHI[i], up: alt > 0,
      s: [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)] });
  }
  return out;
}

// Share of a roof point's yearly sun (isotropic sky, as in the solar model)
// lost to the beam the other buildings block.
function shadeLoss(pt, sl, hours, solids, albedo) {
  const n = sl.normal, q = pt.map((v, j) => v + n[j] * 0.1), others = solids.filter(s => s.key !== sl.key);
  let all = 0, lost = 0;
  for (const h of hours) {
    const cos = n[0] * h.s[0] + n[1] * h.s[1] + n[2] * h.s[2];
    const beam = h.up && cos > 0 ? h.dni * cos * Math.max(0, 1 - 0.05 * (1 / cos - 1)) : 0;
    all += beam + h.dhi * (1 + n[1]) / 2 + h.ghi * albedo * (1 - n[1]) / 2;
    if (beam > 0 && others.some(s => hits(q, h.s, s.hs))) lost += beam;
  }
  return lost / all;
}

// Plan-view roof area: the three roof outlines, less where their eaves overlap.
function roofArea(p) {
  const r = KEYS.map(k => p[k].roof), area = a => (a.x1 - a.x0) * (a.z1 - a.z0);
  const over = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
  return sum(r.map(area)) - over(r[0], r[1]) - over(r[0], r[2]) - over(r[1], r[2]);
}

// Each south slope: the owner's rows where given, otherwise every spot that
// pays, in rows, portrait or landscape, whichever holds more. `room` is how
// many spots on the slope pay. The max fit adds, on every slope that doesn't
// face north, every spot that pays: on the owner's grid where there's a plan.
// wx is prepared weather.
export function roofPV(wx, p = DEFAULTS, s = ROOFPV_INPUTS, pv = SOLAR_INPUTS.pv) {
  const solids = solidsOf(p), hours = sunHours(wx), kw = s.panel.watts / 1000;
  const gap = s.gapIn / 12, long = s.panel.longIn / 12, short = s.panel.shortIn / 12;
  // Where blocks butt together, one roof runs into the other block: no
  // panel inside another block.
  const onRoof = (key, pt) => !solids.some(o => o.key !== key && inside(pt, o.hs));
  const faces = KEYS.flatMap(key => slopesOf(p, key).map(sl => {
    // Shade is worked out panel by panel here, so the yield leaves pv.shade out.
    const perKw = sum(pvPerKw(wx, { ...pv, tilt: sl.tilt * 180 / Math.PI, azimuth: sl.azimuth, shade: 0 }));
    const memo = new Map();
    const loss = (u, w) => {
      const id = `${u.toFixed(2)},${w.toFixed(2)}`;
      if (!memo.has(id)) memo.set(id, shadeLoss(sl.at(u, w), sl, hours, solids, pv.albedo));
      return memo.get(id);
    };
    // The panel at column i (from the west or north end) and row j (from
    // the eave), or null where the slope isn't there.
    const spot = (i, j, w, l) => {
      const u0 = sl.u0 + s.edgeFt + i * (w + gap), w0 = s.edgeFt + j * (l + gap);
      const pts = [[u0 + 0.3, w0 + 0.3], [u0 + w - 0.3, w0 + 0.3], [u0 + 0.3, w0 + l - 0.3], [u0 + w - 0.3, w0 + l - 0.3], [u0 + w / 2, w0 + l / 2]];
      if (!pts.every(([u, v]) => onRoof(sl.key, sl.at(u, v)))) return null;
      const L = sum(pts.map(([u, v]) => loss(u, v))) / pts.length;
      return { c: sl.at(u0 + w / 2, w0 + l / 2), col: i, row: j, loss: L, kept: L <= s.maxLoss };
    };
    // Every spot on the slope in one orientation, with ridgeFt kept clear.
    const grid = (orient, ridgeFt) => {
      const [w, l] = orient === 'portrait' ? [short, long] : [long, short];
      const cols = Math.floor((sl.u1 - sl.u0 - 2 * s.edgeFt + gap) / (w + gap));
      const rows = Math.floor((sl.length - s.edgeFt - ridgeFt + gap) / (l + gap));
      const panels = [];
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const q = spot(i, j, w, l); if (q) panels.push(q); }
      return { orient, rows, cols, w, l, panels, n: panels.filter(q => q.kept).length };
    };
    const open = ridgeFt => [grid('portrait', ridgeFt), grid('landscape', ridgeFt)].reduce((a, b) => (b.n > a.n ? b : a));
    return { ...sl, name: p[sl.key].name, perKw, spot, grid, open };
  }));
  const kwhOf = (sl, qs) => sum(qs.map(q => kw * sl.perKw * (1 - q.loss)));

  const slopes = [];
  for (const key of KEYS) {
    const sl = faces.find(f => f.key === key && f.face === 'S');
    if (!sl) { slopes.push({ key, name: p[key].name, south: false }); continue; }
    const open = sl.open(s.ridgeFt), plan = s.rows?.[key];
    const layout = plan
      ? { orient: 'landscape', rows: plan.length, cols: Math.max(0, ...plan), w: long, l: short, planned: true,
          panels: plan.flatMap((n, j) => Array.from({ length: n }, (_, i) => sl.spot(i, j, long, short))).filter(Boolean).map(q => ({ ...q, kept: true })) }
      : { ...open, planned: false };
    const placed = layout.panels.filter(q => q.kept);
    slopes.push({ key, name: p[key].name, south: true, tilt: sl.tilt, normal: sl.normal, widthFt: sl.u1 - sl.u0, lengthFt: sl.length, perKw: sl.perKw,
      ...layout, n: placed.length, kw: placed.length * kw, kwh: kwhOf(sl, placed),
      worstLoss: Math.max(0, ...placed.map(q => q.loss)), room: open.n });
  }
  const on = slopes.filter(x => x.south);

  // Every slope but the north ones, filled with every spot that pays. With
  // the plan's ridge setback the owner's rows stay and the spots around them
  // on the same grid are added; with the wider one every slope is laid out
  // afresh, since the owner's top row sits closer to the ridge.
  const fit = ridgeFt => faces.map(sl => {
    const own = ridgeFt === s.ridgeFt ? on.find(x => x.key === sl.key && sl.face === 'S' && x.planned && x.n) : null;
    const taken = new Set((own?.panels ?? []).map(q => `${q.col},${q.row}`));
    const g = own ? sl.grid(own.orient, ridgeFt) : sl.open(ridgeFt);
    const extra = g.panels.filter(q => q.kept && !taken.has(`${q.col},${q.row}`));
    const n = (own?.n ?? 0) + extra.length;
    return { key: sl.key, name: sl.name, face: sl.face, azimuth: sl.azimuth, tilt: sl.tilt, normal: sl.normal,
      widthFt: sl.u1 - sl.u0, lengthFt: sl.length, perKw: sl.perKw, orient: g.orient, w: g.w, l: g.l,
      planned: own?.n ?? 0, n, kw: n * kw, kwh: (own?.kwh ?? 0) + kwhOf(sl, extra), extra: extra.map(q => ({ c: q.c, loss: q.loss })) };
  });
  const totalsOf = f => ({ panels: sum(f.map(x => x.n)), kw: sum(f.map(x => x.kw)), kwh: sum(f.map(x => x.kwh)) });
  const max = fit(s.ridgeFt), code = totalsOf(fit(s.ridgeFtOver)), T = totalsOf(max);

  return {
    inputs: s, pitch: p.pitch, ridges: Object.fromEntries(KEYS.map(k => [k, p[k].ridge])),
    slopes,
    totals: { panels: sum(on.map(x => x.n)), kw: sum(on.map(x => x.kw)), kwh: sum(on.map(x => x.kwh)) },
    maxFit: {
      slopes: max, totals: T,
      // Share of the roof, in plan, under panels: past a third, code wants the wider ridge setback.
      coverage: T.panels * long * short * Math.cos(Math.atan(p.pitch)) / roofArea(p),
      code: { ridgeFt: s.ridgeFtOver, ...code },
    },
  };
}
