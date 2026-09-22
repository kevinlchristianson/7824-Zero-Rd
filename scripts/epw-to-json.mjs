// Converts the Casper TMY3 EPW into the compact JSON the thermal model loads.
// Usage: node scripts/epw-to-json.mjs
// Source: EnergyPlus weather data (DOE/NREL TMY3), WMO 725690.
import { readFileSync, writeFileSync } from 'node:fs';

const NAME = 'USA_WY_Casper-Natrona.County.Intl.AP.725690_TMY3';
const SRC = `https://energyplus-weather.s3.amazonaws.com/north_and_central_america_wmo_region_4/USA/WY/${NAME}/${NAME}.epw`;
const lines = readFileSync(new URL(`../data/${NAME}.epw`, import.meta.url), 'utf8').trim().split(/\r?\n/);

const loc = lines[0].split(',');
const dc = lines[1].split(',');
const at = (key, off) => Number(dc[dc.indexOf(key) + off]);
// EnergyPlus DESIGN CONDITIONS layout (ASHRAE 2009 Handbook).
const design = {
  source: dc[2],
  heating: {
    coldestMonth: at('Heating', 1),
    db996C: at('Heating', 2), db990C: at('Heating', 3),
    ws004cMs: at('Heating', 10), dbWs004cC: at('Heating', 11),
    ws010cMs: at('Heating', 12), dbWs010cC: at('Heating', 13),
    wsDb996Ms: at('Heating', 14), wdDb996: at('Heating', 15),
  },
  cooling: {
    hottestMonth: at('Cooling', 1), dailyRangeC: at('Cooling', 2),
    db004C: at('Cooling', 3), mcwb004C: at('Cooling', 4),
    db010C: at('Cooling', 5), mcwb010C: at('Cooling', 6),
    wsDb004Ms: at('Cooling', 15), wdDb004: at('Cooling', 16),
  },
};

// Monthly clear-sky optical depths from the .stat file (ASHRAE 2009).
const stat = readFileSync(new URL(`../data/${NAME}.stat`, import.meta.url), 'latin1');
const row = label => stat.split('\n').find(l => l.includes(label)).trim().split(/\s+/).slice(-12).map(Number);
const taub = row('taub (beam)'), taud = row('taud (diffuse)');

const periods = {};
const tp = lines[2].split(',');
for (let i = 2; i + 3 < tp.length; i += 4) periods[tp[i].trim()] = { kind: tp[i + 1].trim(), start: tp[i + 2].trim(), end: tp[i + 3].trim() };

const data = lines.slice(8).map(l => l.split(','));
if (data.length !== 8760) throw new Error(`expected 8760 hours, got ${data.length}`);
const col = (i, dp = 1) => data.map(r => Number(Number(r[i]).toFixed(dp)));

const out = {
  station: `${loc[1]}, ${loc[2]} (WMO ${loc[5]})`,
  dataset: loc[4], source: SRC,
  lat: Number(loc[6]), lon: Number(loc[7]), tz: Number(loc[8]), elevM: Number(loc[9]),
  pressurePa: 83246,
  firstDay: 'Sunday',       // EPW DATA PERIODS: 1/1 is a Sunday
  design, taub, taud, periods,
  units: { t: 'C', td: 'C', ws: 'm/s', wd: 'deg from N', ghi: 'Wh/m2', dni: 'Wh/m2', dhi: 'Wh/m2' },
  hourly: {
    t: col(6), td: col(7), wd: col(20, 0), ws: col(21),
    ghi: col(13, 0), dni: col(14, 0), dhi: col(15, 0),
  },
};
writeFileSync(new URL('../data/casper-tmy3.json', import.meta.url), JSON.stringify(out));
console.log(`wrote data/casper-tmy3.json: ${out.station}`, JSON.stringify(design));
