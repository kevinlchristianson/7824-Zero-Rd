// Lays out solar panels on the south roof slopes, and the most that fits on
// every slope that doesn't face north, priced like the solar plan; wires the
// shop's array. Writes data/roofpv.json for the 3D viewer and data/wiring.json
// for the wiring sheet. Usage: npm run roofpv
import { readFileSync, writeFileSync } from 'node:fs';
import { prepareWeather } from '../model/thermal.js';
import { pvPerKw, SOLAR_INPUTS, solarPlan, buildContext, evaluate, economics, invOf } from '../model/solar.js';
import { DEFAULTS } from '../model/params.js';
import { roofPV, ROOFPV_INPUTS as S } from '../model/roofpv.js';
import { wiring } from '../model/wiring.js';

const wxRaw = JSON.parse(readFileSync(new URL('../data/casper-tmy3.json', import.meta.url), 'utf8'));
const wx = prepareWeather(wxRaw);
const t0 = performance.now();
const R = roofPV(wx);
const n = v => Math.round(v).toLocaleString('en-US');
const deg = Math.atan(DEFAULTS.pitch) * 180 / Math.PI;
const ground = pvPerKw(wx, { ...SOLAR_INPUTS.pv, tilt: 40, shade: 0 }).reduce((a, b) => a + b, 0);

console.log(`Gable roofs at ${DEFAULTS.pitch * 12}/12 (${deg.toFixed(1)}°); ${S.panel.watts} W panels ${S.panel.longIn.toFixed(1)}" x ${S.panel.shortIn.toFixed(1)}", ${S.gapIn}" apart; ${S.edgeFt * 12}" clear of eaves and gable ends, ${S.ridgeFt * 12}" off ridges; a spot pays when shade costs it at most ${S.maxLoss * 100}%`);
for (const sl of R.slopes) {
  if (!sl.south) { console.log(`  ${sl.name}: ridge runs north-south, no south slope`); continue; }
  const how = sl.planned ? (sl.n ? `your rows of ${S.rows[sl.key].join(', ')} from the eave up` : 'no panels yet') : `${sl.orient} ${sl.rows} rows x ${sl.cols}, ${sl.panels.length - sl.n} spots too shaded`;
  console.log(`  ${sl.name}: slope ${sl.widthFt.toFixed(1)} x ${sl.lengthFt.toFixed(1)} ft, ${how}: ${sl.n} panels (${sl.kw.toFixed(1)} kW, ${n(sl.kwh)} kWh DC/yr, worst ${(sl.worstLoss * 100).toFixed(1)}% shaded); ${sl.room} spots pay`);
}
const T = R.totals;
console.log(`Total: ${T.panels} panels, ${T.kw.toFixed(1)} kW, ${n(T.kwh)} kWh DC/yr (${n(T.kwh / T.kw)} kWh/kW; the 40° ground mount makes ${n(ground)}) (${Math.round(performance.now() - t0)} ms)`);

// The max fit, priced the way the solar plan prices the owner's array: on the
// plan's heat pump setup, each slope at its own tilt, facing and shade, on as
// many of the owner's inverters as its DC needs. Past what the building uses,
// surplus earns the avoided cost, as it would sold outside net metering.
const F = R.maxFit, face = { S: 'south', E: 'east', W: 'west' }, usd = v => '$' + n(v), yrs = v => (v == null ? 'never' : `${v.toFixed(1)} yr`);
console.log(`Max fit, every slope that doesn't face north, ${S.ridgeFt * 12}" off ridges:`);
for (const sl of F.slopes)
  console.log(`  ${sl.name}, ${face[sl.face]} slope: ${sl.n} panels${sl.planned ? ` (your ${sl.planned} + ${sl.n - sl.planned})` : ''}, ${sl.orient}, ${sl.kw.toFixed(1)} kW, ${n(sl.kwh)} kWh DC/yr (${n(sl.perKw)} kWh/kW unshaded)`);
console.log(`Total: ${F.totals.panels} panels, ${F.totals.kw.toFixed(1)} kW, ${n(F.totals.kwh)} kWh DC/yr; ${(F.coverage * 100).toFixed(0)}% of the roof in plan; ${F.code.ridgeFt * 12}" off ridges instead: ${F.code.panels} panels, ${F.code.kw.toFixed(1)} kW`);

const s = SOLAR_INPUTS, A = s.pv.array, M = invOf(s, A.inverter);
const load = solarPlan(wxRaw, s, undefined, wx).recommended.cfg.load;
const ctx = { ...buildContext(wxRaw, s, undefined, wx), m: A.inverter };
const prof = new Float64Array(ctx.n);
for (const sl of F.slopes) {
  const h = pvPerKw(wx, { ...s.pv, tilt: sl.tilt * 180 / Math.PI, azimuth: sl.azimuth, shade: 0 });
  for (let i = 0; i < ctx.n; i++) prof[i] += h[i] * sl.kwh / sl.perKw / F.totals.kw;
}
const inv = Math.ceil(F.totals.kw / M.dc - 1e-9);
const none = evaluate(ctx, { kw: 0, inv: 0, load, battery: false });
const own = evaluate(ctx, { kw: A.kw, inv: A.inv, load, battery: false });
const all = evaluate({ ...ctx, pvDC: prof }, { kw: F.totals.kw, inv, load, battery: false });
const econ = (res, base) => { const e = economics(res, base, s); return { prod: res.prod - (base.prod ?? 0), capex: e.cost, save1: e.save1, payback: e.payback, simple: e.simple, npv: e.npv }; };
F.econ = {
  inverters: inv, inverter: M.name, acKw: inv * M.ac, nemCapKwAC: s.nemCapKwAC, avoided: s.rates.avoided, horizon: s.finance.horizon, discount: s.finance.discount,
  use: own.loadKWh,   // what the building uses with the owner's array (the heat pump spends spare credit on heat)
  all: econ(all, none), plan: econ(own, none), more: econ(all, own),
};
const E = F.econ;
console.log(`On ${inv} x ${M.name} (${E.acKw} kW AC): ${n(E.all.prod)} kWh a year against ${n(E.use)} used; ${usd(E.all.capex)}; saves ${usd(E.all.save1)} the first year; pays back in ${yrs(E.all.payback)} (simple ${yrs(E.all.simple)}), NPV ${usd(E.all.npv)}`);
console.log(`  Your ${A.panels}: ${n(E.plan.prod)} kWh, ${usd(E.plan.capex)}, saves ${usd(E.plan.save1)}, pays back in ${yrs(E.plan.payback)}; the rest: ${n(E.more.prod)} kWh, ${usd(E.more.capex)}, earns ${usd(E.more.save1)} a year, pays back in ${yrs(E.more.payback)}, NPV ${usd(E.more.npv)}`);

const round = (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
writeFileSync(new URL('../data/roofpv.json', import.meta.url), JSON.stringify(R, round));

const D = wiring(R), B = D.bom;
for (const st of D.strings)
  console.log(`  ${st.id} -> inverter ${st.inverter} ${st.input}: ${st.n} panels in columns ${st.cols.join(',')}; Voc ${st.vocCold.toFixed(0)} V at ${D.inputs.lowC} C; ${st.amps.toFixed(1)} A (input takes ${st.iscMax} A); home runs - ${st.minus.ft.toFixed(0)} ft, + ${st.plus.ft.toFixed(0)} ft`);
console.log(`Junction box ${D.jbox.x} ft from the roof's west edge, ${D.jbox.w} ft up the slope; two conduits of ${D.conduits[0].ft.toFixed(0)} ft to the inverters; ${D.jumpers.length} jumpers (${B.jumperFt.toFixed(0)} ft)`);
console.log(`Wire: PV red ${n(B.pvRedFt)} ft, black ${n(B.pvBlackFt)} ft; THWN-2 red ${n(B.thwnRedFt)}, black ${n(B.thwnBlackFt)}, green ${n(B.greenFt)} ft; bare copper ${n(B.bareFt)} ft; ${B.mc4Pairs} MC4 pairs, ${B.rsd} rapid-shutdown units, ${B.terminals} terminals`);
writeFileSync(new URL('../data/wiring.json', import.meta.url), JSON.stringify(D, round));
console.log('wrote data/roofpv.json and data/wiring.json');
