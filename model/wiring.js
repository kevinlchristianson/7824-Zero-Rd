// DC wiring for the shop's roof array: strings, home runs to a roof junction
// box, conduits down to the two inverters in the shop's southeast corner,
// grounding, and the parts list. Works from the roof layout (roofpv.js).
//
// Positions are in slope coordinates: x feet from the roof's west edge along
// the eave, w feet up the slope from the eave edge.

import { DEFAULTS, wallsOf, gableOf } from './params.js';

export const WIRING_INPUTS = {
  panel: { name: 'ZnShine ZXM7-UHLDD108 440 W', voc: 38.80, isc: 14.39, vocPerC: -0.0026 },   // listing; Voc coefficient assumed (typical N-type)
  lowC: -28.8,              // Casper extreme annual mean minimum, ASHRAE 2009 (EPW header)
  perString: 12,
  inverter: {               // EG4 18kPV: 600 V max; one string on each MPPT
    name: 'EG4 18kPV', maxV: 600,
    inputs: [{ name: 'MPPT 1', iscMax: 31 }, { name: 'MPPT 2', iscMax: 19 }, { name: 'MPPT 3', iscMax: 19 }],
  },
  inverterFt: 5,            // inverter height in the shop's southeast corner (owner)
  leadReachFt: 2 * 1.2 * 3.281,   // two Tigo TS4-A-F output leads, about 1.2 m each (assumed)
  slackFt: 3,               // at each home-run end and each end of a drop
};

const sum = a => a.reduce((x, y) => x + y, 0);
const man = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.w - b.w);

export function wiring(layout, p = DEFAULTS, s = WIRING_INPUTS) {
  const sl = layout.slopes.find(x => x.key === 'north'), L = layout.inputs;
  const r = p.north.roof, g = gableOf(p, 'north'), k = p.pitch, sec = Math.hypot(1, k);
  const gap = L.gapIn / 12, W = sl.w, H = sl.l;
  const X = i => L.edgeFt + i * (W + gap) + W / 2, Y = j => L.edgeFt + j * (H + gap) + H / 2;
  const world = (x, w) => ({ x: r.x0 + x, y: g.eaveTop + k * w / sec, z: r.z1 - w / sec });
  const cw = wallsOf(p.center.roof, p.overhang);
  const onRoof = (x, w) => { const q = world(x, w); return !(q.x > cw.x0 && q.x < cw.x1 && q.z > cw.z0 && q.z < cw.z1); };

  // Serpentine up and down the columns, west to east, cut into strings.
  const panels = sl.panels.filter(q => q.kept).map(q => ({ col: q.col, row: q.row, x: X(q.col), w: Y(q.row) }));
  const cols = [...new Set(panels.map(q => q.col))].sort((a, b) => a - b);
  const seq = cols.flatMap((c, n) => {
    const col = panels.filter(q => q.col === c).sort((a, b) => a.row - b.row);
    return n % 2 ? col.reverse() : col;
  });
  const nIn = s.inverter.inputs.length;
  const strings = [];
  for (let i = 0; i < seq.length; i += s.perString) {
    const n = strings.length, list = seq.slice(i, i + s.perString);
    list.forEach((q, t) => { q.string = n; q.pos = t + 1; });
    strings.push({ id: `S${n + 1}`, inverter: 'AB'[Math.floor(n / nIn)] ?? '?', input: s.inverter.inputs[n % nIn].name, panels: list });
  }

  // Jumpers where neighbors in a string sit farther apart than the leads reach.
  const jumpers = [];
  for (const st of strings) for (let t = 1; t < st.panels.length; t++) {
    const a = st.panels[t - 1], b = st.panels[t], d = man(a, b);
    if (d > s.leadReachFt) jumpers.push({ string: st.id, from: [a.x, a.w], to: [b.x, b.w], ft: d - s.leadReachFt + 2 });
  }

  // Inverters inside the shop's southeast corner.
  const sw = wallsOf(r, p.overhang);
  const inv = { x: sw.x1 - p.wallT - 1, y: s.inverterFt, z: sw.z1 - p.wallT - 1 };
  const drop = j => { const q = world(j.x, j.w); return Math.abs(q.x - inv.x) + Math.abs(q.z - inv.z) + (q.y - inv.y) + 2 * s.slackFt; };

  // Junction box where the home runs plus the drops use the least wire.
  const ends = strings.flatMap(st => [st.panels[0], st.panels.at(-1)]);
  let jbox = null;
  for (let x = L.edgeFt; x <= sl.widthFt - L.edgeFt; x += 0.5) for (let w = L.edgeFt; w <= sl.lengthFt - L.ridgeFt; w += 0.5) {
    if (!onRoof(x, w)) continue;
    const j = { x, w }, ft = sum(ends.map(e => man(e, j) + s.slackFt)) + ends.length * drop(j);
    if (!jbox || ft < jbox.ft) jbox = { x, w, ft };
  }
  const run = (e, pol, st) => ({ pol, pts: [[e.x, e.w], [jbox.x, e.w], [jbox.x, jbox.w]], ft: man(e, jbox) + s.slackFt, string: st.id });
  for (const st of strings) {
    st.minus = run(st.panels[0], '-', st);
    st.plus = run(st.panels.at(-1), '+', st);
    st.vocCold = st.panels.length * s.panel.voc * (1 + Math.abs(s.panel.vocPerC) * (25 - s.lowC));
    st.amps = s.panel.isc * 1.25;
    st.iscMax = s.inverter.inputs.find(i => i.name === st.input).iscMax;
    st.kw = st.panels.length * L.panel.watts / 1000;
  }
  const dropFt = drop(jbox);
  const conduits = ['A', 'B'].map(id => ({ id, strings: strings.filter(st => st.inverter === id).map(st => st.id), ft: dropFt }));

  // Ground: one lug at the east end of each row, linked by bare copper down
  // the stepped east side, and a tie from the nearest lug to the junction box.
  const rows = [...new Set(panels.map(q => q.row))].sort((a, b) => b - a);
  const lugs = rows.map(j => ({ x: Math.max(...panels.filter(q => q.row === j).map(q => q.x)) + W / 2, w: Y(j) }));
  const chain = [[lugs[0].x, lugs[0].w]];
  for (let t = 1; t < lugs.length; t++) chain.push([lugs[t - 1].x, lugs[t].w], [lugs[t].x, lugs[t].w]);
  const near = lugs.reduce((a, b) => (man(b, jbox) < man(a, jbox) ? b : a));
  const tie = [[near.x, near.w], [jbox.x, near.w], [jbox.x, jbox.w]];
  const len = pts => sum(pts.slice(1).map((q, t) => Math.abs(q[0] - pts[t][0]) + Math.abs(q[1] - pts[t][1])));
  const groundFt = len(chain) + len(tie);

  const homeRuns = strings.flatMap(st => [st.minus, st.plus]);
  const connectors = homeRuns.length * 2 + jumpers.length * 2;
  const iq = world(jbox.x, jbox.w);
  return {
    inputs: s,
    roof: {
      widthFt: sl.widthFt, lengthFt: sl.lengthFt, edgeFt: L.edgeFt, ridgeFt: L.ridgeFt, tilt: sl.tilt,
      // Where the shop's roof runs into the center block's north wall.
      center: { x: cw.x0 - r.x0, w: (r.z1 - cw.z0) * sec },
    },
    panel: { w: W, l: H, watts: L.panel.watts },
    panels: seq.map(q => ({ x: q.x, w: q.w, string: q.string, pos: q.pos })),
    strings: strings.map(({ panels: ps, ...st }) => ({ ...st, n: ps.length, path: ps.map(q => [q.x, q.w]), cols: [...new Set(ps.map(q => q.col))] })),
    jumpers,
    jbox: { x: jbox.x, w: jbox.w, heightFt: iq.y },
    inverters: { x: inv.x - r.x0, w: (r.z1 - inv.z) * sec, kw: strings.filter(st => st.inverter === 'A').length * s.perString * L.panel.watts / 1000 },
    conduits,
    ground: { lugs, chain, tie, ft: groundFt },
    bom: {
      pvRedFt: sum(homeRuns.filter(h => h.pol === '+').map(h => h.ft)),
      pvBlackFt: sum(homeRuns.filter(h => h.pol === '-').map(h => h.ft)),
      jumperFt: sum(jumpers.map(j => j.ft)),
      thwnRedFt: homeRuns.length / 2 * dropFt, thwnBlackFt: homeRuns.length / 2 * dropFt, greenFt: conduits.length * dropFt,
      bareFt: groundFt,
      mc4Pairs: Math.ceil(connectors / 2), rsd: seq.length, terminals: homeRuns.length,
    },
  };
}
