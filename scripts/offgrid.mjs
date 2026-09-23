// Sizes the outage kit (A) and the full off-grid design (B) and writes
// data/offgrid.json for offgrid.html. Usage: npm run offgrid
import { readFileSync, writeFileSync } from 'node:fs';
import { offgridContext, outageKit, optimizeB, optimizeC, conservation, OFFGRID_INPUTS } from '../model/offgrid.js';
import { buildContext, evaluate, lifeCost, SOLAR_INPUTS } from '../model/solar.js';

const wx = JSON.parse(readFileSync(new URL('../data/casper-tmy3.json', import.meta.url), 'utf8'));
const ctx = offgridContext(wx);
const $ = v => '$' + Math.round(v).toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Grid-tied reference: the solar plan's pick (3.5-ton, smart heating, 21 kW).
const gctx = buildContext(wx, SOLAR_INPUTS); gctx.m = 'sma77';
const g0 = evaluate(gctx, { kw: 0, inv: 0, load: 'c35.smart.1' }), g1 = evaluate(gctx, { kw: 21, inv: 2, load: 'c35.smart.1' });
const grid = { kw: 21, capex: g1.capex, bills: g1.total, life: lifeCost(g1, g0, SOLAR_INPUTS) };

const t0 = performance.now();
const C = conservation();
const A = outageKit(offgridContext(wx, C.s, C.t));
const Anormal = outageKit(ctx);
console.log(`A normal living: worst week ${MON[Anormal.start.month]} ${Anormal.start.day}; best ${Anormal.best.nb} batt + ${Anormal.best.gen} kW, ${Math.round(Anormal.best.th)} thm, ${Math.round(Anormal.best.gal)} gal, peak ${Anormal.best.peak.toFixed(1)} kW`);
console.log(`A conservation: worst week starts ${MON[A.start.month]} ${A.start.day}`);
for (const r of A.rows) console.log(`  ${r.nb} batt (${Math.round(r.battKwh)} kWh) + ${r.gen} kW gen: gen ${r.genH} h, ${Math.round(r.genKwh)} kWh, fuel ${Math.round(r.fuel)} thm; heat ${Math.round(r.heatTh)} thm; total ${Math.round(r.th)} thm = ${Math.round(r.gal)} gal propane → ${r.tank.gal}-gal tank; peak load ${r.peak.toFixed(1)} kW; kit ${$(r.cost)}`);

const cctx = offgridContext(wx, C.s, C.t);
const Bnormal = optimizeB(ctx);
const B = optimizeB(cctx);
console.log('B normal living best:', Bnormal.best && `${Bnormal.best.tons}-ton + ${Bnormal.best.resKw} kW, ${Bnormal.best.kw} kW, ${Math.round(Bnormal.best.battKwh)} kWh, ${$(Bnormal.best.capex)}`);
for (const r of B.rows) {
  const d = r.design;
  console.log(`B ${r.label} + ${r.resKw} kW resistance (behind ${r.behindH} h, longest ${r.longestBehind} h): ` + (d ? `${d.kw} kW on ${d.ni}, ${d.nb} batt (${Math.round(d.battKwh)} kWh), resistance ${Math.round(d.resKwh)} kWh/yr, up front ${$(d.capex)}, 25-yr ${$(d.life)}` : 'house falls behind too long'));
}
console.log('B best:', B.best && `${B.best.tons}-ton + ${B.best.resKw} kW, ${B.best.kw} kW on ${B.best.ni}, ${Math.round(B.best.battKwh)} kWh, ${$(B.best.capex)}`);
const Cw = optimizeC(cctx);
for (const r of Cw.rows.filter(x => x.design).sort((a, b) => a.design.life - b.design.life).slice(0, 10)) {
  const d = r.design, p = r.policy;
  console.log(`C ${r.label}, burn <${p.socOn * 100}%${p.tF != null ? ` or <${p.tF}°F` : ''}: ${d.kw} kW on ${d.ni}, ${d.nb} batt (${Math.round(d.battKwh)} kWh), wood ${d.cords.toFixed(1)} cords (${Math.round(d.woodShare * 100)}% of heat, ${d.burnH} h), up front ${$(d.capex)}, 25-yr ${$(d.life)}`);
}
console.log(`(${Math.round(performance.now() - t0)} ms)`);

const slimB = b => b && { tons: b.tons, resKw: b.resKw, kw: b.kw, ni: b.ni, nb: b.nb, battKwh: b.battKwh, capex: b.capex, life: b.life };
const round = (k, v) => (typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null) : v);
writeFileSync(new URL('../data/offgrid.json', import.meta.url), JSON.stringify({ inputs: OFFGRID_INPUTS, grid, A, Anormal: { best: Anormal.best, start: Anormal.start }, B, Bnormal: { best: slimB(Bnormal.best) }, C: Cw }, round));
console.log('wrote data/offgrid.json');
