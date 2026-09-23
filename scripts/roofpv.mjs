// Lays out solar panels on the south roof slopes and writes data/roofpv.json
// for the 3D viewer. Usage: npm run roofpv
import { readFileSync, writeFileSync } from 'node:fs';
import { prepareWeather } from '../model/thermal.js';
import { pvPerKw, SOLAR_INPUTS } from '../model/solar.js';
import { DEFAULTS } from '../model/params.js';
import { roofPV, ROOFPV_INPUTS as S } from '../model/roofpv.js';

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
console.log('wrote data/roofpv.json');
