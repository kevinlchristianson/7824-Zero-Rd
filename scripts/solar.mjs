// Prints the solar + heat pump plan. Usage: npm run solar [-- --write]
import { readFileSync, writeFileSync } from 'node:fs';
import { buildContext, evaluate, economics, ladder, grid, solarPlan, SOLAR_INPUTS } from '../model/solar.js';

const wx = JSON.parse(readFileSync(new URL('../data/casper-tmy3.json', import.meta.url), 'utf8'));
const t0 = performance.now();
const ctx = buildContext(wx, SOLAR_INPUTS);
const $ = v => '$' + Math.round(v).toLocaleString('en-US');
const yieldKwh = ctx.pv1.reduce((a, b) => a + b, 0);
console.log(`PV: ${yieldKwh.toFixed(0)} kWh/kWdc/yr at ${SOLAR_INPUTS.pv.tilt}° tilt (before clipping)`);
const mon = Array(12).fill(0); ctx.pv1.forEach((v, i) => mon[ctx.month[i]] += v);
console.log('  per month kWh/kW:', mon.map(v => v.toFixed(0)).join(' '));
console.log(`HP covers ${(ctx.hpc.hpShare * 100).toFixed(1)}% of space + water heat; strip backup ${ctx.hpc.backupElec.toFixed(0)} kWh`);
const base = evaluate(ctx, { kw: 0, inv: 0, hp: false, battery: false });
const hpOnly = evaluate(ctx, { kw: 0, inv: 0, hp: true, battery: false });
for (const [k, r] of [['today', base], ['HP, no PV', hpOnly]])
  console.log(`${k.padEnd(10)} load ${r.loadKWh.toFixed(0)} kWh, gas ${r.therms.toFixed(0)} thm → elec ${$(r.elecBill)} gas ${$(r.gasBill)} total ${$(r.total)}`);

const L = ladder(ctx);
console.log('\nPurchase order (each step pays for itself fastest among what is left):');
let cap = 0;
for (const st of L.steps) {
  cap += st.dCap;
  console.log(`  ${st.label.padEnd(40)} +${$(st.dCap).padStart(8)}  saves ${$(st.dSave).padStart(7)}/yr  step payback ${st.pb.toFixed(1)} yr | system ${st.cfg.kw} kW/${st.cfg.inv} inv${st.cfg.hp ? ' +HP' : ''}${st.cfg.battery ? ' +batt' : ''}: bill ${$(st.res.total)}, payback ${st.econ.payback?.toFixed(1)} yr, 25yr ${$(st.econ.gain)}`);
}
const G = grid(ctx);
const best = (f, rows) => rows.filter(r => r.econ.payback != null).sort(f)[0];
const show = (label, r) => console.log(`${label.padEnd(26)} ${r.cfg.kw} kW, ${r.cfg.inv} inv, HP ${r.cfg.hp ? 'yes' : 'no'}, batt ${r.cfg.battery ? 'yes' : 'no'} | capex ${$(r.capex)} saves ${$(r.econ.save1)}/yr payback ${r.econ.payback.toFixed(1)} yr, 25yr gain ${$(r.econ.gain)}, prod ${r.prod.toFixed(0)} kWh, exp ${r.exp.toFixed(0)}, paid out ${$(r.paidOut)}`);
console.log('');
show('Shortest payback', best((a, b) => a.econ.payback - b.econ.payback, G.rows));
show('Largest 25-yr gain', best((a, b) => b.econ.gain - a.econ.gain, G.rows));
show('Largest gain, no HP', best((a, b) => b.econ.gain - a.econ.gain, G.rows.filter(r => !r.cfg.hp)));
show('Largest gain, with HP', best((a, b) => b.econ.gain - a.econ.gain, G.rows.filter(r => r.cfg.hp && !r.cfg.battery)));
console.log(`(${(performance.now() - t0).toFixed(0)} ms)`);

if (process.argv.includes('--write')) {
  const plan = solarPlan(wx, SOLAR_INPUTS);
  const round = (k, v) => (typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null) : v);
  writeFileSync(new URL('../data/solar-defaults.json', import.meta.url), JSON.stringify(plan, round));
  console.log('wrote data/solar-defaults.json');
  for (const v of plan.variants) console.log(`  ${v.label.padEnd(44)} HP best ${v.hp.kw} kW/${v.hp.inv} inv NPV $${Math.round(v.hp.npv)} vs no HP ${v.nohp.kw} kW NPV $${Math.round(v.nohp.npv)} → HP adds $${Math.round(v.gain)} (unmet ${(v.unmet/1e6).toFixed(1)} MMBtu)`);
  console.log('  battery on recommended:', JSON.stringify(plan.battery), 'rec', JSON.stringify(plan.recommended.cfg), plan.recommended.econ);
}
