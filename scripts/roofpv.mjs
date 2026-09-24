// Lays out solar panels on the south roof slopes and wires the shop's array;
// writes data/roofpv.json for the 3D viewer and data/wiring.json for the
// wiring sheet. Usage: npm run roofpv
import { readFileSync, writeFileSync } from 'node:fs';
import { prepareWeather } from '../model/thermal.js';
import { pvPerKw, SOLAR_INPUTS } from '../model/solar.js';
import { DEFAULTS } from '../model/params.js';
import { roofPV, ROOFPV_INPUTS as S } from '../model/roofpv.js';
import { wiring } from '../model/wiring.js';

const wx = prepareWeather(JSON.parse(readFileSync(new URL('../data/casper-tmy3.json', import.meta.url), 'utf8')));
const t0 = performance.now();
const R = roofPV(wx);
const n = v => Math.round(v).toLocaleString('en-US');
const deg = Math.atan(DEFAULTS.pitch) * 180 / Math.PI;
const ground = pvPerKw(wx, SOLAR_INPUTS.pv).reduce((a, b) => a + b, 0);

console.log(`Gable roofs at ${DEFAULTS.pitch * 12}/12 (${deg.toFixed(1)}°); ${S.panel.watts} W panels ${S.panel.longIn.toFixed(1)}" x ${S.panel.shortIn.toFixed(1)}", ${S.gapIn}" apart; ${S.edgeFt * 12}" clear of eaves and gable ends, ${S.ridgeFt * 12}" off ridges; a spot pays when shade costs it at most ${S.maxLoss * 100}%`);
for (const sl of R.slopes) {
  if (!sl.south) { console.log(`  ${sl.name}: ridge runs north-south, no south slope`); continue; }
  const how = sl.planned ? (sl.n ? `your rows of ${S.rows[sl.key].join(', ')} from the eave up` : 'no panels yet') : `${sl.orient} ${sl.rows} rows x ${sl.cols}, ${sl.panels.length - sl.n} spots too shaded`;
  console.log(`  ${sl.name}: slope ${sl.widthFt.toFixed(1)} x ${sl.lengthFt.toFixed(1)} ft, ${how}: ${sl.n} panels (${sl.kw.toFixed(1)} kW, ${n(sl.kwh)} kWh DC/yr, worst ${(sl.worstLoss * 100).toFixed(1)}% shaded); ${sl.room} spots pay`);
}
const T = R.totals;
console.log(`Total: ${T.panels} panels, ${T.kw.toFixed(1)} kW, ${n(T.kwh)} kWh DC/yr (${n(T.kwh / T.kw)} kWh/kW; the 40° ground mount makes ${n(ground)}) (${Math.round(performance.now() - t0)} ms)`);

const round = (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
writeFileSync(new URL('../data/roofpv.json', import.meta.url), JSON.stringify(R, round));

const D = wiring(R), B = D.bom;
for (const st of D.strings)
  console.log(`  ${st.id} -> inverter ${st.inverter} ${st.input}: ${st.n} panels in columns ${st.cols.join(',')}; Voc ${st.vocCold.toFixed(0)} V at ${D.inputs.lowC} C; ${st.amps.toFixed(1)} A (input takes ${st.iscMax} A); home runs - ${st.minus.ft.toFixed(0)} ft, + ${st.plus.ft.toFixed(0)} ft`);
console.log(`Junction box ${D.jbox.x} ft from the roof's west edge, ${D.jbox.w} ft up the slope; two conduits of ${D.conduits[0].ft.toFixed(0)} ft to the inverters; ${D.jumpers.length} jumpers (${B.jumperFt.toFixed(0)} ft)`);
console.log(`Wire: PV red ${n(B.pvRedFt)} ft, black ${n(B.pvBlackFt)} ft; THWN-2 red ${n(B.thwnRedFt)}, black ${n(B.thwnBlackFt)}, green ${n(B.greenFt)} ft; bare copper ${n(B.bareFt)} ft; ${B.mc4Pairs} MC4 pairs, ${B.rsd} rapid-shutdown units, ${B.terminals} terminals`);
writeFileSync(new URL('../data/wiring.json', import.meta.url), JSON.stringify(D, round));
console.log('wrote data/roofpv.json and data/wiring.json');
