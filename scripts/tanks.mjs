// Buffer tank choices run through the grid-tied plan (A's base), B and C:
// the MBTEK BF250 dual-coil, the owner's existing 50-gal gas water heater,
// or a 120-gal 12 kW electric water heater. Writes data/tanks.json.
// Usage: node scripts/tanks.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { offgridContext, optimizeB, optimizeC, simulateC, conservation, outageKit, OFFGRID_INPUTS } from '../model/offgrid.js';
import { buildContext, evaluate, lifeCost, SOLAR_INPUTS } from '../model/solar.js';

const wx = JSON.parse(readFileSync(new URL('../data/casper-tmy3.json', import.meta.url), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));

export const TANKS = [
  { id: 'bf250', label: 'MBTEK BF250 dual-coil', gal: 250, cost: 2890, coil: true, resKw: 0,
    note: 'Buffer as planned. Resistance, if any, from an inline electric boiler.' },
  { id: 'wh50', label: 'Existing 50-gal gas water heater', gal: 50, cost: 300, coil: false, resKw: 0,
    note: 'Tank already owned; $300 assumed for a hydraulic separator and fittings. No coil, so no hot-water preheat.' },
  { id: 'e120', label: '120-gal 12 kW electric water heater', gal: 120, cost: 4300, coil: false, resKw: 12,
    note: 'Rheem ELD120 / A.O. Smith DRE-120 class, about $3,900, plus $400 assumed for its 70 A circuit. No coil.' },
];

const variant = t => {
  const s = clone(SOLAR_INPUTS);
  s.hp.buffer = t.cost;
  if (!t.coil) s.hp.preheatApproachF = 999;     // nothing to preheat hot water with
  const O = { ...clone(OFFGRID_INPUTS), bufferGal: t.gal, tankResKw: t.resKw,
    resOptions: t.resKw ? [0, t.resKw, 20, 30, 45] : OFFGRID_INPUTS.resOptions };
  return { s, O };
};

const out = [];
for (const t of TANKS) {
  const t0 = performance.now(), { s, O } = variant(t);
  // Grid-tied plan (the house A protects): 3.5-ton, smart heating, 21 kW.
  const g = buildContext(wx, s); g.m = 'sma77';
  const g0 = evaluate(g, { kw: 0, inv: 0, load: 'c35.smart.1' }), g1 = evaluate(g, { kw: 21, inv: 2, load: 'c35.smart.1' });
  const grid = { capex: g1.capex, bills: g1.total, life: lifeCost(g1, g0, s) };
  const C = conservation(s), cctx = offgridContext(wx, C.s, C.t);
  const A = outageKit(cctx, O).best;
  const lctx = offgridContext(wx, s); lctx.cons = cctx;
  const B = optimizeB(lctx, O).best, Cw = optimizeC(lctx, O).best;
  const pick = x => x && Object.fromEntries(Object.entries(x).filter(([k]) => !['mon', 'daySoc', 'dayCons'].includes(k)));
  out.push({ ...t, grid, A: pick(A), B: pick(B), C: pick(Cw) });
  console.log(`${t.label} (${Math.round(performance.now() - t0)} ms)
  grid-tied 21 kW: up front $${Math.round(grid.capex)}, bills $${Math.round(grid.bills)}/yr, 25-yr $${Math.round(grid.life)}
  A kit: ${A.nb} batt + ${A.gen} kW, ${Math.round(A.gal)} gal, $${A.cost}
  B: ${B.tons}-ton + ${B.resKw} kW res, ${B.kw} kW PV, ${Math.round(B.battKwh)} kWh, up front $${Math.round(B.capex)}, 25-yr $${Math.round(B.life)}, res ${Math.round(B.resKwh)} kWh
  C: ${Cw.tons}-ton, ${Cw.kw} kW PV, ${Math.round(Cw.battKwh)} kWh, ${Cw.cords.toFixed(1)} cords, up front $${Math.round(Cw.capex)}, 25-yr $${Math.round(Cw.life)}, conserve ${Cw.consH} h`);
}
// C held to the BF250's design, to separate the tank's storage from its coil.
const d0 = out[0].C, fixed = { kw: d0.kw, nb: d0.nb, tons: d0.tons, policy: d0.policy, cons: d0.cons };
const fixedC = [[250, true], [250, false], [120, false], [50, false]].map(([gal, coil]) => {
  const s = clone(SOLAR_INPUTS); if (!coil) s.hp.preheatApproachF = 999;
  const C = conservation(s), l = offgridContext(wx, s); l.cons = offgridContext(wx, C.s, C.t);
  const x = simulateC(l, fixed, { ...OFFGRID_INPUTS, bufferGal: gal });
  console.log(`C fixed at BF250 design, ${gal} gal ${coil ? 'coil' : 'no coil'}: short ${Math.round(x.unserved)} kWh, conserve ${x.consH} h`);
  return { gal, coil, unserved: x.unserved, consH: x.consH, cords: x.cords, load: x.load };
});
const round = (k, v) => (typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null) : v);
writeFileSync(new URL('../data/tanks.json', import.meta.url), JSON.stringify({ tanks: out, fixedC, fixed }, round));
