// Runs the heating and cooling model and prints a report.
// Usage: npm run thermal [-- --json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runModel, energyBill, slimResult, ZONES, ZONE_NAMES, GROUPS, INPUTS, sessionSummary } from '../model/thermal.js';

const wx = JSON.parse(readFileSync(new URL('../data/casper-tmy3.json', import.meta.url), 'utf8'));
const t0 = performance.now();
const r = runModel(wx, INPUTS);
const ms = performance.now() - t0;
const bill = energyBill(r);
const k = n => (n / 1000).toFixed(1);
const mm = n => (n / 1e6).toFixed(1);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

console.log(`7824 Zero Rd heating & cooling model (${ms.toFixed(0)} ms)`);
console.log(`Weather: ${wx.station}, ${wx.dataset}`);
console.log(`Design heating ${(wx.design.heating.db996C * 1.8 + 32).toFixed(1)}°F, wind ${(wx.design.heating.wsDb996Ms * 2.237).toFixed(1)} mph; cooling ${(wx.design.cooling.db004C * 1.8 + 32).toFixed(1)}°F\n`);

console.log('Zone geometry');
for (const z of ZONES) {
  const Z = r.env.zones[z];
  console.log(`  ${pad(ZONE_NAMES[z], 22)} floor ${lpad(Z.A.toFixed(0), 5)} ft²  volume ${lpad(Z.V.toFixed(0), 6)} ft³  ELA ${Z.ELA.toFixed(0)} in²`);
}
console.log(`  loggia ${r.env.loggiaLen} ft × depth → ${r.env.loggiaArea} ft²; party walls shop ${r.env.partyLen.shop} ft, south leg ${r.env.partyLen.garage} ft`);

console.log('\nUA at rating films, Btu/h·°F (air leakage excluded)');
console.log('  ' + pad('', 22) + GROUPS.map(([g]) => lpad(g, 9)).join(''));
for (const z of ZONES) console.log('  ' + pad(ZONE_NAMES[z], 22) + GROUPS.map(([g]) => lpad(r.ua[z][g].toFixed(1), 9)).join(''));

console.log('\nDesign heating (steady, no sun or gains), kBtu/h');
for (const z of ZONES) {
  const d = r.heatDesign[z];
  const parts = Object.entries(d.parts).filter(([, v]) => Math.abs(v) > 50).map(([g, v]) => `${g} ${k(v)}`).join(', ');
  console.log(`  ${pad(ZONE_NAMES[z], 22)} ${lpad(k(d.load), 6)}  T ${d.T.toFixed(1)}°F  leak ${d.cfm.toFixed(0)} cfm  [${parts}]`);
}
console.log(`  worst TMY3 hour: total ${k(r.worst.total)} kBtu/h at ${r.worst.T.toFixed(1)}°F, wind ${r.worst.V.toFixed(1)} mph (hour ${r.worst.i})`);
console.log('  wind curve at design temp:', r.windCurve.map(w => `${w.mph}mph ${k(w.shop + w.ground + w.upper)}`).join(' | '));
console.log(`\nDesign cooling (upper): ${k(r.coolDesign.upper.load)} kBtu/h = ${(r.coolDesign.upper.load / 12000).toFixed(2)} tons at hour ${r.coolDesign.upper.hour}`);
console.log('  capacities: heat', Object.entries(r.capHeat).map(([z, v]) => `${z} ${k(v)}`).join(', '), '| cool upper', k(r.capCool.upper));

const M = r.main;
console.log('\nAnnual');
for (const [kk, z] of ZONES.entries()) {
  const avgCfm = M.infilCfmH[kk] / M.infilHours, ach = avgCfm * 60 / r.env.zones[z].V;
  const rec = M.recovery[kk];
  const recStr = rec.length ? ` recovery avg ${(rec.reduce((s, x) => s + x.h, 0) / rec.length).toFixed(1)} h max ${Math.max(...rec.map(x => x.h)).toFixed(1)} h (${rec.filter(x => !x.met).length} unmet of ${rec.length})` : '';
  console.log(`  ${pad(ZONE_NAMES[z], 22)} heat ${lpad(mm(M.heatTot[kk]), 6)} MMBtu  cool ${lpad(mm(M.coolTot[kk]), 5)}  T ${M.Tmin[kk].toFixed(1)}–${M.Tmax[kk].toFixed(1)}°F  peakH ${k(M.peakHeat[kk])}  leak ${ach.toFixed(2)} ACH  unmet ${M.unmet[kk]} h${recStr}`);
}
console.log(`  total heat ${bill.heatMMBtu.toFixed(1)} MMBtu → ${bill.fuelQty.toFixed(0)} ${bill.fuelUnit} $${bill.heatCost.toFixed(0)}; cool ${bill.coolMMBtu.toFixed(1)} MMBtu → ${bill.coolKWh.toFixed(0)} kWh $${bill.coolCost.toFixed(0)}`);
if (r.calm) {
  const calmHeat = ZONES.reduce((s, z, kk) => s + r.calm.heatTot[kk], 0);
  console.log(`  without wind: heat ${(calmHeat / 1e6).toFixed(1)} MMBtu → wind adds ${((bill.heatMMBtu * 1e6 - calmHeat) / 1e6).toFixed(1)} MMBtu (${((bill.heatMMBtu * 1e6 / calmHeat - 1) * 100).toFixed(0)}%)`);
}
console.log('\nAnnual net heat flow out of each zone, MMBtu');
console.log('  ' + pad('', 22) + GROUPS.map(([g]) => lpad(g, 8)).join('') + lpad('solar', 8) + lpad('intern', 8) + lpad('heat', 8) + lpad('cool', 8) + lpad('resid', 8));
for (const [kk, z] of ZONES.entries()) {
  const f = M.flows[kk];
  const loss = f.reduce((s, v) => s + v, 0);
  const resid = M.heatTot[kk] - M.coolTot[kk] + M.solar[kk] + M.internal[kk] - loss;
  console.log('  ' + pad(ZONE_NAMES[z], 22) + GROUPS.map((_, i) => lpad(mm(f[i]), 8)).join('') + lpad(mm(M.solar[kk]), 8) + lpad(mm(M.internal[kk]), 8) + lpad(mm(M.heatTot[kk]), 8) + lpad(mm(M.coolTot[kk]), 8) + lpad(mm(resid), 8));
}
console.log('\nMonthly heating MMBtu (shop / ground / upper) and upper cooling');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
for (let m = 0; m < 12; m++) console.log(`  ${MON[m]}  ${[0, 2, 3].map(z => lpad(mm(M.heat[z][m]), 6)).join('')}   cool ${lpad(mm(M.cool[3][m]), 5)}`);
console.log('\nSessions:', 'shop', JSON.stringify(sessionSummary(INPUTS, 'shop')), 'ground', JSON.stringify(sessionSummary(INPUTS, 'ground')));

// --write: save the default-input results (without hourly traces) for the
// page to show before its own run finishes.
if (process.argv.includes('--write')) {
  const slim = slimResult(r);
  delete slim.main.T; delete slim.main.Qh; delete slim.main.Qc; delete slim.wx;
  const round = (k, v) => {
    if (ArrayBuffer.isView(v)) v = Array.from(v);
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    return v;
  };
  const out = new URL('../data/thermal-defaults.json', import.meta.url);
  writeFileSync(out, JSON.stringify(slim, round));
  console.log(`\nwrote data/thermal-defaults.json (${(JSON.stringify(slim, round).length / 1024).toFixed(0)} KB)`);
}
