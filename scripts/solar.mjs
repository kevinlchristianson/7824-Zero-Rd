// Prints the solar + heat pump plan. Usage: npm run solar [-- --write]
import { readFileSync, writeFileSync } from 'node:fs';
import { solarPlan, SOLAR_INPUTS } from '../model/solar.js';

const wx = JSON.parse(readFileSync(new URL('../data/casper-tmy3.json', import.meta.url), 'utf8'));
const t0 = performance.now();
const P = solarPlan(wx, SOLAR_INPUTS);
const $ = v => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
const yr = v => (v == null ? 'never' : v.toFixed(1) + ' yr');
const sys = c => `${c.kw} kW on ${c.inv}`;

console.log(`PV: ${P.pvYield.toFixed(0)} kWh/kW/yr at ${SOLAR_INPUTS.pv.tilt}° tilt with ${P.inverter.name}; per month ${P.pvMonthly.map(v => v.toFixed(0)).join(' ')}`);
console.log(`Today (no cooling): ${P.today.loadKWh.toFixed(0)} kWh, ${P.today.therms.toFixed(0)} therms, bills ${$(P.today.total)}/yr`);

console.log('\nHeat pump setups, each with its cheapest array and inverter (25-year cost, lower is better):');
for (const r of P.setups)
  console.log(`  ${r.label.padEnd(16)} ${r.mode.padEnd(5)} HP ${$(r.hpCost).padStart(7)}  ${String(r.kw).padStart(2)} kW on ${r.inv} ${r.invName.padEnd(20)} up front ${$(r.capex).padStart(8)}  bills ${$(r.bills).padStart(6)}/yr  25-yr ${$(r.cost).padStart(8)}  (${r.otherMode} ${$(r.otherCost)})  heat share ${(r.hpShare * 100).toFixed(0)}%  cooling short ${r.coolUnmetHrs} h`);
console.log(`Chosen: ${P.setup.label}, ${P.setup.mode}`);

console.log(`\nInverters on the ${P.setup.label}, each with its own purchase order:`);
for (const r of P.inverters)
  console.log(`  ${r.name.padEnd(20)} ${sys(r.cfg).padEnd(12)} cost ${$(r.capex).padStart(8)} (inverter ${$(r.invCapex).padStart(7)})  saves ${$(r.save1).padStart(6)}/yr  payback ${yr(r.payback).padStart(8)}  NPV ${$(r.npv).padStart(8)}  clipped ${(r.clipped * 100).toFixed(1)}%`);

console.log(`\nPurchase order with ${P.inverter.name}${P.inverter.auto ? ' (best value)' : ''}:`);
for (const st of P.steps)
  console.log(`  ${st.label.padEnd(44)} +${$(st.dCap).padStart(8)}  saves ${$(st.dSave).padStart(7)}/yr  step payback ${st.pb.toFixed(1)} yr  worth ${$(st.dNpv)}`);
for (const st of P.rejected)
  console.log(`  (not yet) ${st.label.padEnd(34)} +${$(st.dCap).padStart(8)}  saves ${$(st.dSave).padStart(7)}/yr  step payback ${st.pb.toFixed(1)} yr  worth ${$(st.dNpv)}`);
const R = P.recommended;
console.log(`Recommended: ${sys(R.cfg)}, ${$(R.capex)}, saves ${$(R.econ.save1)}/yr, payback ${yr(R.econ.payback)}, NPV ${$(R.econ.npv)}, bills ${$(R.total)}`);
console.log(`Battery on top: ${$(P.battery.dCap)} saves ${$(P.battery.dSave)}/yr${P.battery.possible ? '' : ' (not possible on this inverter)'}`);
for (const v of P.variants) console.log(`  ${v.label.padEnd(44)} → ${v.winner}  ${Object.entries(v.per).map(([k, x]) => `${k} ${$(x.cost)} (${x.mode}, ${x.kw} kW)`).join('  ')}`);
console.log(`(${(performance.now() - t0).toFixed(0)} ms)`);

if (process.argv.includes('--write')) {
  const round = (k, v) => (typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null) : v);
  writeFileSync(new URL('../data/solar-defaults.json', import.meta.url), JSON.stringify(P, round));
  console.log('wrote data/solar-defaults.json');
}
