// Sizes the off-grid designs and writes data/offgrid.json for offgrid.html.
// Usage: npm run offgrid
import { readFileSync, writeFileSync } from 'node:fs';
import { offgridContext, simulate, cheapest, OFFGRID_INPUTS } from '../model/offgrid.js';
import { buildContext, evaluate, lifeCost, SOLAR_INPUTS } from '../model/solar.js';

const wx = JSON.parse(readFileSync(new URL('../data/casper-tmy3.json', import.meta.url), 'utf8'));
const ctx = offgridContext(wx);
const $ = v => '$' + Math.round(v).toLocaleString('en-US');
const slim = x => { const { mon, daySoc, ...rest } = x; return rest; };
const show = x => `${x.tons}-ton ${x.kw} kW on ${x.ni}, ${x.nb} batt (${Math.round(x.battKwh)} kWh): up front ${$(x.capex)}, gas hours ${x.gasH}, gen ${Math.round(x.genKwh)} kWh, Navien ${Math.round(x.navTh)} thm, resistance ${Math.round(x.resKwh)} kWh, behind setpoint ${x.behindH} h (longest ${x.longestBehind} h), spilled ${Math.round(x.spill / 1000)} MWh, bills ${$(x.annual)}/yr, 25-yr ${$(x.life)}`;

// Grid-tied reference: the solar plan's pick (3.5-ton, smart heating, 21 kW).
const gctx = buildContext(wx, SOLAR_INPUTS); gctx.m = 'sma77';
const g0 = evaluate(gctx, { kw: 0, inv: 0, load: 'c35.smart.1' }), g1 = evaluate(gctx, { kw: 21, inv: 2, load: 'c35.smart.1' });
const grid = { kw: 21, capex: g1.capex, bills: g1.total, life: lifeCost(g1, g0, SOLAR_INPUTS) };
console.log('Grid-tied reference', $(grid.capex), 'up front,', $(grid.bills), '/yr, 25-yr', $(grid.life));

const out = { inputs: OFFGRID_INPUTS, grid, rules: {} };
// P: gas stays. Cheapest, and a version where the generator almost never runs.
const P = cheapest(ctx, 'P', '3.5');
// The same, sized so the generator runs a day a year or less.
const quietPick = [24, 30, 36, 42, 48].flatMap(kw => [3, 4, 5, 6, 7, 8].map(nb => simulate(ctx, { rule: 'P', tons: '3.5', kw, nb })))
  .filter(x => x.gasH <= 24).sort((a, b) => a.life - b.life)[0];
out.rules.P = { best: simulate(ctx, P, undefined, true), quiet: quietPick ? simulate(ctx, quietPick, undefined, true) : null };
console.log('P cheapest:', show(P)); if (quietPick) console.log('P generator ≤ 1 day:', show(quietPick));
for (const rule of ['A', 'B']) {
  const rows = [];
  for (const t of Object.keys(OFFGRID_INPUTS.tons)) {
    const b = cheapest(ctx, rule, t);
    const short = ((ctx._ae ??= {})[rule + t] ??= ctx.allElectric(OFFGRID_INPUTS.tons[t].tons, rule === 'B', OFFGRID_INPUTS.hpwhCop)).short;
    rows.push({ tons: t, label: OFFGRID_INPUTS.tons[t].label, hpShortH: short, design: b ? slim(b) : null });
    console.log(`${rule} ${t}-ton (short ${short} h):`, b ? show(b) : 'none in range');
  }
  const ok = rows.filter(r => r.design).sort((a, b) => a.design.life - b.design.life)[0];
  out.rules[rule] = { rows, best: ok ? simulate(ctx, ok.design, undefined, true) : null };
}
const round = (k, v) => (typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null) : v);
writeFileSync(new URL('../data/offgrid.json', import.meta.url), JSON.stringify(out, round));
console.log('wrote data/offgrid.json');
