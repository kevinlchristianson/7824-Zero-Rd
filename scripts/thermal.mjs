// Runs the heating and cooling model and prints a report.
// Usage: npm run thermal [-- --json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runModel, slimResult, ZONES, ZONE_NAMES, GROUPS, INPUTS, sessionSummary, SENSITIVITY, sensitivityCase, calibrationGrid } from '../model/thermal.js';

const wx = JSON.parse(readFileSync(new URL('../data/casper-tmy3.json', import.meta.url), 'utf8'));
const t0 = performance.now();
const r = runModel(wx, INPUTS);
const ms = performance.now() - t0;
const cost = r.cost.totals;
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
console.log(`  porch ${r.env.porchLen} ft × depth → ${r.env.porchArea} ft² (outdoors); party walls shop ${r.env.partyLen.shop} ft, south leg ${r.env.partyLen.garage} ft`);

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
console.log(`  total heat ${mm(cost.heat)} MMBtu → ${cost.therms.toFixed(0)} therms; cool ${mm(cost.cool)} MMBtu → ${cost.compKWh.toFixed(0)} kWh compressor; AHU + pumps ${cost.distKWh.toFixed(0)} kWh (${cost.heatHours.toFixed(0)} h heating, ${cost.coolHours.toFixed(0)} h cooling)`);
console.log(`  COST: heating $${cost.heating.toFixed(0)} (gas $${cost.gas.toFixed(0)} + fan/pumps $${cost.heatElec.toFixed(0)}), cooling $${cost.cooling.toFixed(0)}, total $${cost.total.toFixed(0)}/yr; fixed service charges $${cost.fixed.toFixed(0)}/yr`);
for (const [k, v] of Object.entries(r.range)) console.log(`  center ACH50 ${v.ach50}: heat ${mm(v.cost.totals.heat)} MMBtu, cool ${mm(v.cost.totals.cool)}, total $${v.cost.totals.total.toFixed(0)}/yr (${k})`);
if (r.calm) {
  const calmHeat = ZONES.reduce((s, z, kk) => s + r.calm.heatTot[kk], 0);
  console.log(`  without wind: heat ${(calmHeat / 1e6).toFixed(1)} MMBtu → wind adds ${((cost.heat - calmHeat) / 1e6).toFixed(1)} MMBtu (${((cost.heat / calmHeat - 1) * 100).toFixed(0)}%)`);
}
if (r.asis) {
  const a = r.asis, at = a.cost.totals, ai = INPUTS.asis;
  console.log(`\nThis winter, ${a.upperDone ? 'upper level renovated and ground level as-is' : 'center block before the renovation'} (foam R-${ai.wallR} on brick, R-${ai.roofR} attic, U-${ai.windowU} windows, ACH50 ${ai.ach50}; shop as given; same setpoints and equipment)`);
  for (const [kk, z] of ZONES.entries()) if (z !== 'garage') console.log(`  ${pad(ZONE_NAMES[z], 22)} heat ${lpad(mm(a.heatTot[kk]), 6)} MMBtu  cool ${lpad(mm(a.coolTot[kk]), 5)}  design ${lpad(k(a.heatDesign[z].load), 5)} kBtu/h  peakH ${k(a.peakHeat[kk])}  Tmin ${a.Tmin[kk].toFixed(1)}°F  unmet ${a.unmet[kk]} h`);
  console.log(`  COST: heating $${(at.gas + at.heatElec).toFixed(0)} (${at.therms.toFixed(0)} therms), cooling $${at.cooling.toFixed(0)}, total $${at.total.toFixed(0)}/yr; ACH50 ${a.range.low.ach50}: $${a.range.low.cost.totals.total.toFixed(0)}, ACH50 ${a.range.high.ach50}: $${a.range.high.cost.totals.total.toFixed(0)}`);
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
const zi = z => ZONES.indexOf(z);
for (let m = 0; m < 12; m++) console.log(`  ${MON[m]}  ${['shop', 'ground', 'upper'].map(z => lpad(mm(M.heat[zi(z)][m]), 6)).join('')}   cool ${lpad(mm(M.cool[zi('upper')][m]), 5)}`);
console.log('\nSessions:', 'shop', JSON.stringify(sessionSummary(INPUTS, 'shop')), 'ground', JSON.stringify(sessionSummary(INPUTS, 'ground')));

const sens = { base: r.cost.totals.total, rows: SENSITIVITY.map(c => ({ key: c.key, label: c.label, better: sensitivityCase(c, 'better', r), worse: sensitivityCase(c, 'worse', r) })) };
console.log('\nWhat could move the annual cost ($' + sens.base.toFixed(0) + ')');
for (const x of [...sens.rows].sort((a, b) => (b.worse.total - b.better.total) - (a.worse.total - a.better.total)))
  console.log(`  ${x.label.padEnd(30)} ${x.better.label.padStart(14)} $${x.better.total.toFixed(0).padStart(5)}   ${x.worse.label.padStart(14)} $${x.worse.total.toFixed(0).padStart(5)}`);

// --write: save the default-input results (without hourly traces) for the
// page to show before its own run finishes.
if (process.argv.includes('--write')) {
  const slim = slimResult(r);
  slim.sensitivity = sens;
  slim.calib = { state: 'asis', rows: calibrationGrid(r, 'asis') };
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
