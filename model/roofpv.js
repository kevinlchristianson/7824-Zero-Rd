// Solar panels on the south-facing roof slopes of 7824 Zero Rd, and how much
// sun each one loses to the other buildings, hour by hour on the Casper TMY3
// year. Only a gable whose ridge runs east-west has a south slope. Trees are
// left out (owner). Diffuse light is taken as unshaded.

import { DEFAULTS, wallsOf, gableOf } from './params.js';
import { pvPerKw, SOLAR_INPUTS } from './solar.js';

export const ROOFPV_INPUTS = {
  panel: { watts: 440, longIn: 1762 / 25.4, shortIn: 1134 / 25.4 },   // a typical 440 W residential panel, 1762 x 1134 mm
  gapIn: 1,          // between panels
  edgeFt: 1,         // clear of the eaves and gable ends
  ridgeFt: 1.5,      // off the ridge: the fire-code setback while panels cover under a third of the roof
  maxLoss: 0.10,     // leave out spots that lose more than this share of their sun to shade
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

// The south slope of a block whose ridge runs east-west. at(x, w) is the
// roof surface point w feet up the slope from the outer eave edge.
function southSlope(p, key) {
  const g = gableOf(p, key);
  if (!g.alongX) return null;
  const r = p[key].roof, k = p.pitch, sec = Math.hypot(1, k);
  return {
    key, x0: r.x0, x1: r.x1, length: g.half * sec, tilt: Math.atan(k), normal: [0, 1 / sec, k / sec],
    at: (x, w) => { const run = w / sec; return [x, g.eaveTop + k * run, r.z1 - run]; },
  };
}

// Where two blocks butt together, a roof runs into the other block's wall:
// no roof inside another block's walls.
function onRoof(p, key, [x, , z]) {
  return KEYS.every(o => {
    if (o === key) return true;
    const w = wallsOf(p[o].roof, p.overhang);
    return !(x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1);
  });
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

// Fill each south slope with panels in rows, portrait or landscape,
// whichever holds more that pay; a spot is left out when shade costs it
// more than maxLoss of its sun. wx is prepared weather.
export function roofPV(wx, p = DEFAULTS, s = ROOFPV_INPUTS, pv = SOLAR_INPUTS.pv) {
  const solids = solidsOf(p), hours = sunHours(wx), kw = s.panel.watts / 1000;
  const gap = s.gapIn / 12, long = s.panel.longIn / 12, short = s.panel.shortIn / 12;
  const slopes = [];
  for (const key of KEYS) {
    const sl = southSlope(p, key);
    if (!sl) { slopes.push({ key, name: p[key].name, south: false }); continue; }
    const perKw = sum(pvPerKw(wx, { ...pv, tilt: sl.tilt * 180 / Math.PI }));
    const memo = new Map();
    const loss = (x, w) => {
      const id = `${x.toFixed(2)},${w.toFixed(2)}`;
      if (!memo.has(id)) memo.set(id, shadeLoss(sl.at(x, w), sl, hours, solids, pv.albedo));
      return memo.get(id);
    };
    let best = null;
    for (const [orient, w, l] of [['portrait', short, long], ['landscape', long, short]]) {
      const cols = Math.floor((sl.x1 - sl.x0 - 2 * s.edgeFt + gap) / (w + gap));
      const rows = Math.floor((sl.length - s.edgeFt - s.ridgeFt + gap) / (l + gap));
      const panels = [];
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x0 = sl.x0 + s.edgeFt + i * (w + gap), w0 = s.edgeFt + j * (l + gap);
        const pts = [[x0 + 0.3, w0 + 0.3], [x0 + w - 0.3, w0 + 0.3], [x0 + 0.3, w0 + l - 0.3], [x0 + w - 0.3, w0 + l - 0.3], [x0 + w / 2, w0 + l / 2]];
        if (!pts.every(([x, y]) => onRoof(p, key, sl.at(x, y)))) continue;
        const L = sum(pts.map(([x, y]) => loss(x, y))) / pts.length;
        panels.push({ c: sl.at(x0 + w / 2, w0 + l / 2), loss: L, kept: L <= s.maxLoss });
      }
      const kept = panels.filter(q => q.kept);
      const res = { orient, rows, cols, w, l, panels, n: kept.length, kw: kept.length * kw, kwh: sum(kept.map(q => kw * perKw * (1 - q.loss))) };
      if (!best || res.kw > best.kw) best = res;
    }
    slopes.push({ key, name: p[key].name, south: true, tilt: sl.tilt, normal: sl.normal, widthFt: sl.x1 - sl.x0, lengthFt: sl.length, perKw, ...best });
  }
  const on = slopes.filter(x => x.south);
  return {
    inputs: s, pitch: p.pitch, ridges: Object.fromEntries(KEYS.map(k => [k, p[k].ridge])),
    slopes,
    totals: { fit: sum(on.map(x => x.panels.length)), panels: sum(on.map(x => x.n)), kw: sum(on.map(x => x.kw)), kwh: sum(on.map(x => x.kwh)) },
  };
}
