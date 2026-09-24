// Heating and cooling model for 7824 Zero Rd.
//
// Five zones, simulated on the Casper TMY3 year in 15-minute steps:
//   shop    north leg main block        heated, deep setback
//   vest    vestibule across its west end   unconditioned buffer
//   ground  center block, ground level  heated, setback
//   upper   center block, upper level   heated and cooled
//   garage  south leg                   unconditioned
// Each zone is an air node plus a thermal-mass node (slab or finishes).
// Envelope conduction uses wind-dependent outside films and sol-air
// temperatures; air leakage follows the LBL model (stack + wind) from
// blower-door tightness, driven by hourly TMY3 wind. I-P units throughout.
//
// Geometry and the opening inventory come from params.js, so this model and
// the 3D model always describe the same building.

import { DEFAULTS, wallsOf, vestibuleDepth, openings, openingArea } from './params.js';

export const ZONES = ['shop', 'vest', 'ground', 'upper', 'garage'];
export const ZONE_NAMES = {
  shop: 'Shop', vest: 'Vestibule', ground: 'Center, ground level',
  upper: 'Center, upper level', garage: 'South leg',
};
export const GROUPS = [
  ['walls', 'Walls'], ['ceiling', 'Roof / attic'], ['windows', 'Windows & glass'],
  ['doors', 'Doors'], ['slab', 'Slab edge'], ['floor', 'Exposed floor'],
  ['air', 'Air leakage'], ['zones', 'To other zones'],
];

// ---------------------------------------------------------------- inputs

export const INPUTS = {
  shop: {
    wallR: 15, ceilingR: 40, minF: 45, occF: 70, hoursPerWeek: 12,
    sessionHours: 6, startHour: 8, ach50: 1.5, gainsOn: 0.3, gainsOff: 0,
  },
  vest: { wallR: 15, ceilingR: 40, ach50: 6 },          // owner: walls built like the shop's, 12" brick + R-15 CCF
  // Center block airtightness is unknown: a best guess for both levels,
  // plus the tight and leaky ends of a plausible range.
  center: { ach50: 5, achLow: 3, achHigh: 8 },
  ground: {
    wallR: 30, ceilingR: 20, minF: 60, occF: 70, hoursPerWeek: 28,
    sessionHours: 7, startHour: 9, gainsOn: 0.3, gainsOff: 0.03,
  },
  upper: {
    wallR: 30, roofR: 60, heatF: 68, coolF: 68, unoccDays: 40, unoccMinF: 55,
    gainsOn: 0.2, gainsOff: 0.05,
  },
  garage: { wallR: 0, ceilingR: 0, ach50: 15 },
  party: { shopCenterR: 15, garageCenterR: 30, shopVestR: 15 },
  glass: {
    windowU: 0.45, windowSHGC: 0.45, blinds: 0.85, doorU: 0.35,
    archU: 0.55, archSHGC: 0.55, garageDoorU: 1.0,
  },
  slab: { F: 0.73 },
  brickR: 2.0,
  // Share of the foam's R-value the wall actually gets: 1 for continuous
  // foam, about 0.6 with wood studs through it, about 0.4 with steel studs.
  framing: 0.6,
  site: { shelter: 2, wind: true, groundRefl: 0.2 },
  // Navien condensing combi-boiler heats; MBTEK Apollo 3.5-ton air-to-water
  // heat pump cools; both through an MBTEK AP-AHU-6T air handler.
  plant: {
    boilerEff: 0.88, coolCOP: 4.6, coolTons: 3.5, distLoss: 0.10,
    fanW: 460, pumpW: 150, ahuHeatBtuh: 90000,
  },
  // Marginal rates from the owner's Aug-2026 bills, taxes and riders included.
  // Gas, Black Hills Energy RGS GCA (WY103): 0.2008 volumetric - 0.0115
  // revenue adj + 0.0203 integrity rider + 0.3398 commodity - 0.0007 EE,
  // plus 5% sales tax. Electric, Rocky Mountain Power Schedule 25:
  // 0.06467 energy + 0.02997 net power cost - 0.00052 renewable adj,
  // plus 2.84% efficiency services, 0.05% carbon capture and 5% sales tax.
  // Winter gas (Nov-Mar) from the Jan-2026 bill on the same schedule
  // (Palmer Dr premise, city fees removed): 0.2008 volumetric - 0.0049
  // revenue adj + 0.0203 integrity rider + 0.3449 commodity + 0.0088 EE,
  // plus 5% sales tax. `gas` is the Apr-Oct rate.
  rates: { gas: 0.576, gasWinter: 0.598, winterMonths: [10, 11, 0, 1, 2], elec: 0.1017, gasMonthly: 34.65, elecMonthly: 37.46 },
};

// Input schema for forms and reports. src: 'given' = from the owner,
// 'assumed' = a placeholder to confirm.
export const SCHEMA = [
  { group: 'Shop (north leg)', items: [
    ['shop.wallR', 'Wall foam (CCF)', 'R', 'given', 0, 60, 0.5],
    ['shop.ceilingR', 'Attic insulation', 'R', 'given', 0, 100, 1],
    ['shop.minF', 'Minimum temperature', '°F', 'given', 32, 75, 1],
    ['shop.occF', 'In-use temperature', '°F', 'given', 50, 80, 1],
    ['shop.hoursPerWeek', 'Hours in use per week', 'h', 'given', 0, 168, 1],
    ['shop.sessionHours', 'Hours per session', 'h', 'given', 1, 24, 1],
    ['shop.startHour', 'Session start', 'hour', 'assumed', 0, 23, 1],
    ['shop.ach50', 'Airtightness (“super airtight”)', 'ACH50', 'assumed', 0.3, 30, 0.1],
    ['shop.gainsOn', 'Lights, tools, people in use', 'W/ft²', 'assumed', 0, 5, 0.05],
  ] },
  { group: 'Center airtightness', note: 'Unknown, so costs are shown for a best guess and a tight-to-leaky range. A blower-door test would pin it down.', items: [
    ['center.ach50', 'Best guess, both levels', 'ACH50', 'assumed', 0.3, 30, 0.1],
    ['center.achLow', 'Tight end of range', 'ACH50', 'assumed', 0.3, 30, 0.1],
    ['center.achHigh', 'Leaky end of range', 'ACH50', 'assumed', 0.3, 30, 0.1],
  ] },
  { group: 'Center, ground level', items: [
    ['ground.wallR', 'Wall insulation', 'R', 'given', 0, 60, 0.5],
    ['ground.ceilingR', 'Ceiling to upper level', 'R', 'given', 0, 60, 1],
    ['ground.minF', 'Minimum temperature', '°F', 'given', 32, 75, 1],
    ['ground.occF', 'In-use temperature', '°F', 'given', 50, 80, 1],
    ['ground.hoursPerWeek', 'Hours in use per week', 'h', 'given', 0, 168, 1],
    ['ground.sessionHours', 'Hours per session', 'h', 'assumed', 1, 24, 1],
    ['ground.startHour', 'Session start', 'hour', 'assumed', 0, 23, 1],
    ['ground.gainsOn', 'Lights, people in use', 'W/ft²', 'assumed', 0, 5, 0.05],
    ['ground.gainsOff', 'Standby loads', 'W/ft²', 'assumed', 0, 2, 0.01],
  ] },
  { group: 'Center, upper level', items: [
    ['upper.wallR', 'Wall insulation', 'R', 'given', 0, 60, 0.5],
    ['upper.roofR', 'Roof insulation', 'R', 'given', 0, 100, 1],
    ['upper.heatF', 'Heat to', '°F', 'given', 50, 80, 1],
    ['upper.coolF', 'Cool to', '°F', 'given', 60, 85, 1],
    ['upper.unoccDays', 'Unoccupied days per year', 'd', 'given', 0, 365, 1],
    ['upper.unoccMinF', 'Minimum when unoccupied', '°F', 'given', 32, 75, 1],
    ['upper.gainsOn', 'Lights, appliances, people', 'W/ft²', 'assumed', 0, 5, 0.05],
    ['upper.gainsOff', 'Standby loads when away', 'W/ft²', 'assumed', 0, 2, 0.01],
  ] },
  { group: 'Equipment', items: [
    ['plant.boilerEff', 'Navien seasonal efficiency', '×', 'assumed', 0.7, 0.99, 0.01],
    ['plant.distLoss', 'Duct and piping losses', '×', 'assumed', 0, 0.4, 0.01],
    ['plant.coolCOP', 'Apollo cooling COP', '×', 'given', 1.5, 8, 0.1],
    ['plant.coolTons', 'Apollo capacity', 'tons', 'given', 1, 10, 0.5],
    ['plant.fanW', 'AHU draw while running', 'W', 'given', 0, 2000, 10],
    ['plant.pumpW', 'Circulators and controls', 'W', 'assumed', 0, 1000, 10],
    ['plant.ahuHeatBtuh', 'AHU heat output, full fan', 'Btu/h', 'assumed', 10000, 400000, 1000],
  ] },
  { group: 'Rates (from your bills)', items: [
    ['rates.gasWinter', 'Gas, per therm, Nov–Mar, all-in', '$', 'given', 0, 5, 0.001],
    ['rates.gas', 'Gas, per therm, Apr–Oct, all-in', '$', 'given', 0, 5, 0.001],
    ['rates.elec', 'Electricity, per kWh, all-in', '$', 'given', 0, 1, 0.0001],
    ['rates.gasMonthly', 'Gas customer charge, per month', '$', 'given', 0, 200, 0.01],
    ['rates.elecMonthly', 'Electric basic charge, per month', '$', 'given', 0, 200, 0.01],
  ] },
  { group: 'Vestibule', items: [
    ['vest.wallR', 'Wall foam (CCF)', 'R', 'given', 0, 60, 0.5],
    ['vest.ceilingR', 'Attic insulation', 'R', 'assumed', 0, 100, 1],
    ['vest.ach50', 'Airtightness', 'ACH50', 'assumed', 0.3, 40, 0.1],
  ] },
  { group: 'South leg', items: [
    ['garage.wallR', 'Wall insulation (no foam)', 'R', 'given', 0, 60, 0.5],
    ['garage.ceilingR', 'Ceiling insulation', 'R', 'assumed', 0, 100, 1],
    ['garage.ach50', 'Airtightness', 'ACH50', 'assumed', 0.3, 50, 0.1],
  ] },
  { group: 'Walls between zones', items: [
    ['party.shopCenterR', 'Shop ↔ center', 'R', 'assumed', 0, 60, 0.5],
    ['party.garageCenterR', 'South leg ↔ center', 'R', 'assumed', 0, 60, 0.5],
    ['party.shopVestR', 'Shop ↔ vestibule', 'R', 'given', 0, 60, 0.5],
  ] },
  { group: 'Windows & doors', items: [
    ['glass.windowU', 'Window U-factor', 'U', 'assumed', 0.1, 1.3, 0.01],
    ['glass.windowSHGC', 'Window SHGC', '', 'assumed', 0.1, 0.9, 0.01],
    ['glass.blinds', 'Blinds pass-through', '×', 'assumed', 0.3, 1, 0.05],
    ['glass.doorU', 'Door U-factor', 'U', 'assumed', 0.1, 1.3, 0.01],
    ['glass.archU', 'Vestibule arch glass U', 'U', 'assumed', 0.1, 1.3, 0.01],
    ['glass.archSHGC', 'Vestibule arch SHGC', '', 'assumed', 0.1, 0.9, 0.01],
    ['glass.garageDoorU', 'Overhead door U', 'U', 'assumed', 0.1, 1.5, 0.01],
  ] },
  { group: 'Walls, slab & masonry', items: [
    ['framing', 'Foam effectiveness (1 continuous, 0.6 wood studs, 0.4 steel)', '×', 'assumed', 0.2, 1, 0.05],
    ['slab.F', 'Slab edge F-factor', 'Btu/h·ft·°F', 'assumed', 0.1, 1.2, 0.01],
    ['brickR', '12″ brick', 'R', 'assumed', 0.5, 5, 0.1],
  ] },
  { group: 'Wind & site', items: [
    ['site.wind', 'Hourly TMY3 wind', 'on/off', 'given', 0, 1, 1],
    ['site.shelter', 'Shelter class (1 open – 5 urban)', '', 'assumed', 1, 5, 1],
    ['site.groundRefl', 'Ground reflectance', '', 'assumed', 0, 0.9, 0.05],
  ] },
];

export function getIn(obj, path) { return path.split('.').reduce((o, k) => o[k], obj); }
export function setIn(obj, path, v) {
  const ks = path.split('.'), last = ks.pop();
  ks.reduce((o, k) => o[k], obj)[last] = v;
}

// ---------------------------------------------------------------- constants

const MPH = 2.23694;            // m/s -> mph
const SOLAR = 0.3170;           // W/m² -> Btu/h·ft²
const F = c => c * 1.8 + 32;
const R_IN = 0.68, R_OUT_RATED = 0.17;        // wall films, rating conditions
const R_CEIL_IN = 0.61, R_ATTIC = 0.61, R_FLOOR_IN = 0.92, R_SHELTERED = 0.46;
const GYP = 0.45, SUBFLOOR = 1.0;
const FACES = ['N', 'E', 'S', 'W'];

// LBL infiltration coefficients (ASHRAE Fundamentals, I-P):
// cfm = ELA[in²] · sqrt(Cs·|ΔT| + Cw·U²), U = weather-station wind [mph].
const CS_STORY = 0.0150;
const CW = {
  1: [0.0119, 0.0157, 0.0184], 2: [0.0092, 0.0121, 0.0143], 3: [0.0065, 0.0086, 0.0101],
  4: [0.0039, 0.0051, 0.0060], 5: [0.0012, 0.0016, 0.0018],
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function cwCoef(shelter, stories) {
  const r = CW[clamp(Math.round(shelter), 1, 5)], s = clamp(stories, 1, 3);
  const i = Math.min(1, Math.floor(s - 1)), f = s - 1 - i;
  return r[i] + f * (r[i + 1] - r[i]);
}

// Outside film coefficient [Btu/h·ft²·°F] vs local wind [mph]:
// 6.0 at 15 mph (R-0.17 winter design), 4.0 at 7.5 mph, ~2 in calm air.
const hOut = v => 2.0 + 0.267 * v;
const FILM_WIND = 0.7;          // building-height wind / weather-station wind
const ATTIC_SOLAR = 0.45;       // share of roof sol-air rise that reaches attic air
const ROOF_ABS = 0.9, WALL_ABS = 0.55, DOOR_ABS = 0.6, OHDOOR_ABS = 0.3;

// ---------------------------------------------------------------- envelope

// Turns the massing geometry into thermal zones and envelope elements.
export function buildEnvelope(p = DEFAULTS, inp = INPUTS) {
  const c = p.center;
  const C = wallsOf(c.roof, p.overhang);
  const N = wallsOf(p.north.roof, p.overhang);
  const vd = vestibuleDepth(p);
  const SHOP = { ...N, x0: N.x0 + vd }, VEST = { ...N, x1: N.x0 + vd };
  const GAR = wallsOf(p.south.roof, p.overhang);
  const plate = c.ground + c.floor + c.upper;

  const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const within = (v, a0, a1) => v > a0 + 1e-9 && v < a1 - 1e-9;
  const faceLen = (R, f) => (f === 'N' || f === 'S') ? R.x1 - R.x0 : R.z1 - R.z0;
  // Length of R's f edge that lies inside Q or against Q's opposite face
  // (buildings that butt together share that stretch of wall).
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const edgeIn = (R, f, Q) => {
    if (f === 'N') return within(R.z0, Q.z0, Q.z1) || near(R.z0, Q.z1) ? ov(R.x0, R.x1, Q.x0, Q.x1) : 0;
    if (f === 'S') return within(R.z1, Q.z0, Q.z1) || near(R.z1, Q.z0) ? ov(R.x0, R.x1, Q.x0, Q.x1) : 0;
    if (f === 'W') return within(R.x0, Q.x0, Q.x1) || near(R.x0, Q.x1) ? ov(R.z0, R.z1, Q.z0, Q.z1) : 0;
    return within(R.x1, Q.x0, Q.x1) || near(R.x1, Q.x0) ? ov(R.z0, R.z1, Q.z0, Q.z1) : 0;
  };
  // Floors, ceilings and volumes use inside dimensions; walls use outside.
  const t = p.wallT;
  const area = R => Math.max(0, R.x1 - R.x0 - 2 * t) * Math.max(0, R.z1 - R.z0 - 2 * t);
  const overlap = (A, B) => ov(A.x0, A.x1, B.x0, B.x1) * ov(A.z0, A.z1, B.z0, B.z1);
  const partyLen = R => FACES.reduce((s, f) => s + edgeIn(C, f, R), 0);

  // The arched porch sits outside the center's west wall, between the legs;
  // the ground level's west wall faces it, the upper level's faces the deck.
  const porchLen = faceLen(C, 'W') - edgeIn(C, 'W', SHOP) - edgeIn(C, 'W', GAR);
  const porchArea = Math.max(0, porchLen) * c.porchDepth;

  const zones = {
    shop: { A: area(SHOP) - overlap(SHOP, C), H: p.north.wall, hStack: p.north.wall, hWind: p.north.wall, slabMass: true, furnish: 1.0 },
    vest: { A: area(VEST), H: p.north.wall, hStack: p.north.wall, hWind: p.north.wall, slabMass: true, furnish: 0.2 },
    ground: { A: area(C), H: c.ground, hStack: c.ground, hWind: c.ground, slabMass: true, furnish: 1.0 },
    upper: { A: area(C), H: c.upper, hStack: c.upper, hWind: plate, slabMass: false, furnish: 2.0 },
    garage: { A: area(GAR) - overlap(GAR, C), H: p.south.wall, hStack: p.south.wall, hWind: p.south.wall, slabMass: true, furnish: 0.5 },
  };
  for (const z of Object.values(zones)) z.V = z.A * z.H;

  // Exterior wall runs [ft] by zone and face ('L' = under the porch).
  const runs = {
    shop: { N: faceLen(SHOP, 'N') - edgeIn(SHOP, 'N', C), E: faceLen(SHOP, 'E') - edgeIn(SHOP, 'E', C), S: faceLen(SHOP, 'S') - edgeIn(SHOP, 'S', C) },
    vest: { N: faceLen(VEST, 'N'), S: faceLen(VEST, 'S'), W: faceLen(VEST, 'W') },
    ground: {
      N: faceLen(C, 'N') - edgeIn(C, 'N', SHOP) - edgeIn(C, 'N', GAR),
      E: faceLen(C, 'E') - edgeIn(C, 'E', SHOP) - edgeIn(C, 'E', GAR),
      S: faceLen(C, 'S') - edgeIn(C, 'S', SHOP) - edgeIn(C, 'S', GAR),
      L: porchLen,
    },
    upper: { N: faceLen(C, 'N'), E: faceLen(C, 'E'), S: faceLen(C, 'S'), W: faceLen(C, 'W') },
    garage: Object.fromEntries(FACES.map(f => [f, faceLen(GAR, f) - edgeIn(GAR, f, C)])),
  };

  const els = [];     // exterior elements (to out, attic or porch)
  const links = [];   // zone-to-zone conductances
  const openA = {};   // opening area subtracted from each wall run
  const key = (z, b) => `${z}:${b}`;
  const g = inp.glass;

  const shade = o => {
    const pn = o.panel;
    if (pn === 'center.W' && o.zone === 'ground') return { P: c.porchDepth, gap: c.ground - o.top, diffuse: 0.5 };
    if (pn.startsWith('center.')) return o.zone === 'upper' ? { P: p.overhang, gap: plate - o.top, diffuse: 1 } : { P: 0, gap: 0, diffuse: 1 };
    if (pn.startsWith('north.')) return { P: p.overhang, gap: p.north.wall - o.top, diffuse: 1 };
    return { P: p.overhang, gap: p.south.wall - o.top, diffuse: 1 };
  };

  for (const o of openings(p)) {
    if (o.kind === 'open') continue;
    const A = openingArea(o);
    const glazed = o.kind === 'window' || o.kind === 'glassDoor' || o.kind === 'arch';
    const U = o.kind === 'arch' ? g.archU : glazed ? g.windowU : o.kind === 'garageDoor' ? g.garageDoorU : g.doorU;
    const Rcore = Math.max(0.05, 1 / U - R_IN - R_OUT_RATED);
    if (o.to) {
      links.push({ a: o.zone, b: o.to, group: 'doors', G: A / (Rcore + 2 * R_IN), A });
      openA[key(o.zone, o.to)] = (openA[key(o.zone, o.to)] || 0) + A;
      continue;
    }
    const bound = o.panel === 'center.W' && o.zone === 'ground' ? 'porch' : 'out';
    const b = bound === 'porch' ? 'L' : o.face;
    openA[key(o.zone, b)] = (openA[key(o.zone, b)] || 0) + A;
    els.push({
      zone: o.zone, group: glazed ? 'windows' : 'doors', to: bound, face: o.face, A, Rcore, Rin: R_IN,
      alpha: glazed ? 0 : o.kind === 'garageDoor' ? OHDOOR_ABS : DOOR_ABS,
      glass: glazed ? { shgc: o.kind === 'arch' ? g.archSHGC : g.windowSHGC, h: o.top - o.sill, ...shade(o) } : null,
    });
  }

  // Opaque walls.
  const fx = inp.framing;
  const wallRcore = {
    shop: inp.shop.wallR * fx + inp.brickR + GYP,
    vest: inp.vest.wallR * fx + inp.brickR + GYP,
    ground: inp.ground.wallR * fx + inp.brickR + GYP,
    upper: inp.upper.wallR * fx + inp.brickR + GYP,
    garage: inp.garage.wallR * fx + inp.brickR,
  };
  // The 2' floor structure between the levels has an exterior edge too; each
  // level takes half of it on its outside walls.
  const wallH = { ground: c.ground + c.floor / 2, upper: c.upper + c.floor / 2 };
  for (const z of ZONES) {
    for (const [b, run] of Object.entries(runs[z])) {
      const gross = run * (wallH[z] ?? zones[z].H);
      const A = gross - (openA[key(z, b)] || 0);
      if (A <= 0) continue;
      els.push({ zone: z, group: 'walls', to: b === 'L' ? 'porch' : 'out', face: b === 'L' ? 'W' : b, A, Rcore: wallRcore[z], Rin: R_IN, alpha: WALL_ABS, gross });
    }
  }

  // Ceilings to vented attics.
  const ceil = (z, R) => els.push({ zone: z, group: 'ceiling', to: 'attic', face: 'H', A: zones[z].A, Rcore: R + GYP, Rin: R_CEIL_IN });
  ceil('shop', inp.shop.ceilingR);
  ceil('vest', inp.vest.ceilingR);
  ceil('upper', inp.upper.roofR);
  ceil('garage', inp.garage.ceilingR);

  const floorR = inp.ground.ceilingR + GYP + SUBFLOOR;

  // Zone-to-zone.
  const link = (a, b, group, A, R) => A > 0 && links.push({ a, b, group, A, G: A / R });
  const doorA = (a, b) => (openA[key(a, b)] || 0) + (openA[key(b, a)] || 0);
  link('ground', 'upper', 'floor', zones.ground.A, floorR + R_CEIL_IN + R_FLOOR_IN);
  const pShop = partyLen(SHOP), pGar = partyLen(GAR);
  const hSG = Math.min(p.north.wall, c.ground + c.floor / 2);
  const shopParty = inp.party.shopCenterR * fx + inp.brickR + 2 * GYP + 2 * R_IN;
  link('shop', 'ground', 'walls', pShop * hSG - doorA('shop', 'ground'), shopParty);
  link('shop', 'upper', 'walls', pShop * Math.max(0, p.north.wall - hSG), shopParty);
  link('garage', 'ground', 'walls', pGar * Math.min(p.south.wall, c.ground + c.floor / 2) - doorA('garage', 'ground'),
    inp.party.garageCenterR * fx + inp.brickR + GYP + 2 * R_IN);
  link('shop', 'vest', 'walls', faceLen(SHOP, 'W') * p.north.wall - doorA('shop', 'vest'),
    inp.party.shopVestR * fx + inp.brickR + GYP + 2 * R_IN);
  // Slab edge between shop and vestibule.
  links.push({ a: 'shop', b: 'vest', group: 'slab', A: 0, G: inp.slab.F * faceLen(SHOP, 'W') });

  // Slab-on-grade perimeter to outdoors (F-factor, vs 24 h mean outdoor air).
  const slabLen = Object.fromEntries(ZONES.map(z => [z, z === 'upper' ? 0 :
    Object.values(runs[z]).reduce((s, v) => s + v, 0)]));
  for (const z of ZONES) if (slabLen[z] > 0) els.push({ zone: z, group: 'slab', to: 'out24', face: 'H', L: slabLen[z], G: inp.slab.F * slabLen[z] });

  // Air leakage: effective leakage area from ACH50 (ELA ≈ 0.055 in² per CFM50).
  for (const z of ZONES) {
    const Z = zones[z], ach50 = z === 'ground' || z === 'upper' ? inp.center.ach50 : inp[z].ach50;
    Z.ELA = 0.055 * ach50 * Z.V / 60;
    Z.Cs = CS_STORY * Z.hStack / 8;
    Z.Cw = cwCoef(inp.site.shelter, Z.hWind / 8);
    // Thermal capacitance [Btu/°F] and air-to-mass coupling [Btu/h·°F].
    Z.Ca = Z.V * 0.0148 + Z.furnish * Z.A;
    Z.Cm = Z.slabMass ? 9.33 * Z.A : 3.0 * Z.A;
    Z.Ham = Z.slabMass ? Z.A / R_FLOOR_IN : 3.0 * Z.A;
  }

  return { zones, els, links, runs, slabLen, porchArea, porchLen, partyLen: { shop: pShop, garage: pGar } };
}

// UA [Btu/h·°F] by zone and group at rating films (15 mph), without air leakage.
export function uaTable(env) {
  const out = Object.fromEntries(ZONES.map(z => [z, Object.fromEntries(GROUPS.map(([k]) => [k, 0]))]));
  for (const e of env.els) {
    const G = e.G ?? e.A / (e.Rcore + e.Rin + (e.to === 'out' ? R_OUT_RATED : e.to === 'attic' ? R_ATTIC : R_SHELTERED));
    out[e.zone][e.group] += G;
  }
  for (const l of env.links) { out[l.a].zones += l.G; out[l.b].zones += l.G; }
  return out;
}

// ---------------------------------------------------------------- weather

// Solar position and per-hour series from the TMY3 JSON.
export function prepareWeather(wx) {
  const n = wx.hourly.t.length;
  const w = {
    n, T: new Float64Array(n), V: new Float64Array(n), WD: new Float64Array(n),
    GHI: new Float64Array(n), DNI: new Float64Array(n), DHI: new Float64Array(n),
    alt: new Float64Array(n), az: new Float64Array(n), T24: new Float64Array(n),
    month: new Uint8Array(n), day: new Uint16Array(n), dayMeanF: new Float64Array(n / 24),
    lat: wx.lat, lon: wx.lon, tz: wx.tz,
  };
  const mdays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const lat = wx.lat * Math.PI / 180;
  for (let i = 0; i < n; i++) {
    w.T[i] = F(wx.hourly.t[i]);
    w.V[i] = wx.hourly.ws[i] * MPH;
    w.WD[i] = wx.hourly.wd[i];
    w.GHI[i] = wx.hourly.ghi[i]; w.DNI[i] = wx.hourly.dni[i]; w.DHI[i] = wx.hourly.dhi[i];
    const d = Math.floor(i / 24);
    w.day[i] = d;
    let m = 0, acc = mdays[0];
    while (d >= acc) acc += mdays[++m];
    w.month[i] = m;
    const [alt, az] = sunPosition(lat, wx.lon, wx.tz, d + 1, (i % 24) + 0.5);
    w.alt[i] = alt; w.az[i] = az;
  }
  for (let d = 0; d < n / 24; d++) {
    let s = 0;
    for (let h = 0; h < 24; h++) s += w.T[d * 24 + h];
    w.dayMeanF[d] = s / 24;
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 24; k++) s += w.T[(i - k + n) % n];
    w.T24[i] = s / 24;
  }
  return w;
}

// Sun altitude and azimuth [rad; azimuth clockwise from north] at local
// standard time `hour` (fractional) on day-of-year `doy`.
export function sunPosition(latRad, lonDeg, tz, doy, hour) {
  const g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eot + 4 * lonDeg - 60 * tz;
  const H = (tst / 4 - 180) * Math.PI / 180;
  const sinAlt = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(H);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(latRad) - Math.tan(decl) * Math.cos(latRad)) + Math.PI;
  return [alt, az];
}

// Schedules for a series: which hours each zone is in use, which days are
// heating-degree days, and which days the upper level is empty.
function schedules(w, inp, firstDow = 0) {
  const occWeek = z => {
    const s = inp[z], occ = new Uint8Array(168);
    const hours = Math.round(s.hoursPerWeek), len = Math.max(1, Math.round(s.sessionHours));
    if (hours <= 0) return occ;
    const n = Math.ceil(hours / len);
    const days = [];
    for (let k = 0; k < n; k++) days.push(((6 - Math.round(k * 7 / n)) % 7 + 7) % 7);
    days.sort((a, b) => a - b);
    days.forEach((d, i) => {
      const hrs = i < n - 1 ? len : hours - len * (n - 1);
      for (let h = 0; h < hrs; h++) occ[(d * 24 + Math.round(s.startHour) + h) % 168] = 1;
    });
    return occ;
  };
  const days = w.n / 24, nU = Math.round(inp.upper.unoccDays);
  const away = new Uint8Array(days);
  for (let d = 0; d < days; d++) away[d] = Math.floor((d + 1) * nU / days) > Math.floor(d * nU / days) ? 1 : 0;
  return { shop: occWeek('shop'), ground: occWeek('ground'), away, firstDow };
}

export function sessionSummary(inp, z) {
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const occ = schedules({ n: 24 }, { ...inp, upper: { unoccDays: 0 } })[z];
  const blocks = [];
  for (let d = 0; d < 7; d++) {
    let h = 0;
    while (h < 24) {
      if (occ[d * 24 + h]) {
        const s = h;
        while (h < 24 && occ[d * 24 + h]) h++;
        blocks.push({ day: DOW[d], start: s, end: h });
      } else h++;
    }
  }
  return blocks;
}

// ---------------------------------------------------------------- solver

function solveInPlace(A, b, x, n) {
  for (let k = 0; k < n; k++) {
    let piv = k, max = Math.abs(A[k * n + k]);
    for (let r = k + 1; r < n; r++) {
      const v = Math.abs(A[r * n + k]);
      if (v > max) { max = v; piv = r; }
    }
    if (piv !== k) {
      for (let c = 0; c < n; c++) { const t = A[k * n + c]; A[k * n + c] = A[piv * n + c]; A[piv * n + c] = t; }
      const t = b[k]; b[k] = b[piv]; b[piv] = t;
    }
    const d = A[k * n + k];
    for (let r = k + 1; r < n; r++) {
      const f = A[r * n + k] / d;
      if (f === 0) continue;
      for (let c = k; c < n; c++) A[r * n + c] -= f * A[k * n + c];
      b[r] -= f * b[k];
    }
  }
  for (let k = n - 1; k >= 0; k--) {
    let s = b[k];
    for (let c = k + 1; c < n; c++) s -= A[k * n + c] * x[c];
    x[k] = s / A[k * n + k];
  }
}

const GIDX = Object.fromEntries(GROUPS.map(([k], i) => [k, i]));
const NG = GROUPS.length, NZ = ZONES.length;
const ZI = Object.fromEntries(ZONES.map((z, k) => [z, k]));
const FIDX = { N: 0, E: 1, S: 2, W: 3, H: 4 };
const TO = { out: 0, attic: 1, porch: 2, out24: 3 };

// Envelope elements as flat arrays, compiled once per envelope.
const compiled = new WeakMap();
function compile(env) {
  let c = compiled.get(env);
  if (c) return c;
  const E = env.els, n = E.length;
  c = {
    n, z: new Int8Array(n), g: new Int8Array(n), f: new Int8Array(n), t: new Int8Array(n),
    A: new Float64Array(n), R: new Float64Array(n), G: new Float64Array(n), alpha: new Float64Array(n),
    glass: E.map(e => e.glass),
  };
  E.forEach((e, k) => {
    c.z[k] = ZI[e.zone]; c.g[k] = GIDX[e.group]; c.f[k] = FIDX[e.face]; c.t[k] = TO[e.to];
    c.A[k] = e.A ?? 0; c.R[k] = (e.Rcore ?? 0) + (e.Rin ?? 0); c.G[k] = e.G ?? 0; c.alpha[k] = e.alpha ?? 0;
  });
  compiled.set(env, c);
  return c;
}

function newBoundary() {
  return {
    G: new Float64Array(NZ * NG), GT: new Float64Array(NZ * NG), sol: new Float64Array(NZ),
    ho: new Float64Array(5), I: new Float64Array(4), beam: new Float64Array(4),
    ci: new Float64Array(4), tp: new Float64Array(4), T: 0, V: 0, Tattic: 0,
  };
}

// Boundary conditions for weather hour i: per zone and group, the sum of
// conductances and of conductance x boundary temperature, plus solar gain
// through glass. Wind sets the outside film (windward faces full local wind,
// leeward half); sun sets sol-air temperatures and attic heating.
function hourBoundary(env, inp, wx, i, windOn, B) {
  const c = compile(env);
  const T = wx.T[i], V = windOn ? wx.V[i] : 0, wd = wx.WD[i] * Math.PI / 180;
  const alt = wx.alt[i], az = wx.az[i];
  const dni = wx.DNI[i], dhi = wx.DHI[i], ghi = wx.GHI[i];
  const rho = inp.site.groundRefl;
  const sunUp = alt > 0, cosAlt = Math.cos(alt), tanAlt = Math.tan(alt);
  const vLocal = FILM_WIND * V;
  const diffV = 0.5 * dhi + 0.5 * rho * ghi;
  for (let f = 0; f < 4; f++) {
    const rel = az - f * Math.PI / 2;
    B.ho[f] = hOut(Math.cos(wd - f * Math.PI / 2) > 0 ? vLocal : 0.5 * vLocal);
    const cr = Math.cos(rel), ci = sunUp ? cosAlt * cr : 0;
    B.ci[f] = ci;
    B.beam[f] = ci > 0 ? dni * ci : 0;
    B.tp[f] = sunUp && cr > 1e-3 ? tanAlt / cr : Infinity;
    B.I[f] = B.beam[f] + diffV;
  }
  B.ho[4] = hOut(vLocal);
  const Tattic = T + ATTIC_SOLAR * ROOF_ABS * ghi * SOLAR / B.ho[4];
  B.G.fill(0); B.GT.fill(0); B.sol.fill(0);
  const blinds = inp.glass.blinds, T24 = wx.T24[i];
  for (let k = 0; k < c.n; k++) {
    const t = c.t[k], f = c.f[k];
    let G, Tb;
    if (t === 3) { G = c.G[k]; Tb = T24; }
    else if (t === 1) { G = c.A[k] / (c.R[k] + R_ATTIC); Tb = Tattic; }
    else if (t === 2) { G = c.A[k] / (c.R[k] + R_SHELTERED); Tb = T; }
    else {
      const h = B.ho[f];
      G = c.A[k] / (c.R[k] + 1 / h);
      Tb = c.glass[k] ? T : T + c.alpha[k] * B.I[f] * SOLAR / h;
    }
    const idx = c.z[k] * NG + c.g[k];
    B.G[idx] += G; B.GT[idx] += G * Tb;
    const q = c.glass[k];
    if (q && (sunUp || ghi > 0)) {
      let bm = 0;
      const ci = B.ci[f];
      if (ci > 0) {
        const iam = Math.max(0, 1 - 0.15 * (1 / ci - 1));
        let lit = 1;
        if (q.P > 0 && isFinite(B.tp[f])) lit = 1 - clamp((q.P * B.tp[f] - q.gap) / q.h, 0, 1);
        bm = B.beam[f] * iam * lit;
      }
      B.sol[c.z[k]] += c.A[k] * q.shgc * blinds * (bm + 0.9 * diffV * q.diffuse) * SOLAR;
    }
  }
  B.T = T; B.V = V; B.Tattic = Tattic;
  return B;
}

function infilG(Z, dT, V) {
  // Sensible heat of leakage air at Casper's elevation (air ~82% of sea-level density).
  const cfm = Z.ELA * Math.sqrt(Z.Cs * Math.abs(dT) + Z.Cw * V * V);
  return { G: 1.08 * 0.822 * cfm, cfm };
}

// ---------------------------------------------------------------- dynamic simulation

// Steps every zone through `hours` of the weather series `wx` (after
// `warmup` hours that are simulated but not counted) under the thermostat
// schedule `sched`. Returns monthly and annual results for the counted hours.
export function simulate(env, wx, inp, opts = {}) {
  const {
    windOn = inp.site.wind, capHeat = {}, capCool = {}, warmup = 720, hours = wx.n,
    record = false, sched = schedules(wx, inp), idealLoads = false, dow0 = 0, hddOverride = null,
  } = opts;
  const nz = NZ, n = 2 * nz, dt = 0.25, sub = 4;
  const Z = ZONES.map(z => env.zones[z]);
  const A = new Float64Array(n * n), b = new Float64Array(n), x = new Float64Array(n);
  const A0 = new Float64Array(n * n), b0 = new Float64Array(n);
  const Ta = new Float64Array(nz), Tm = new Float64Array(nz);
  const init = [inp.shop.minF, 45, inp.ground.minF, inp.upper.heatF, 40];
  for (let k = 0; k < nz; k++) { Ta[k] = init[k]; Tm[k] = init[k]; }
  const links = env.links.map(l => ({ ...l, ia: ZONES.indexOf(l.a), ib: ZONES.indexOf(l.b) }));
  const bnd = newBoundary();

  const res = {
    heat: ZONES.map(() => new Float64Array(12)), cool: ZONES.map(() => new Float64Array(12)),
    flows: ZONES.map(() => new Float64Array(NG)), solar: new Float64Array(nz), internal: new Float64Array(nz),
    heatTot: new Float64Array(nz), coolTot: new Float64Array(nz),
    peakHeat: new Float64Array(nz), peakCool: new Float64Array(nz), peakCoolAt: new Int32Array(nz),
    Tmin: new Float64Array(nz).fill(Infinity), Tmax: new Float64Array(nz).fill(-Infinity),
    TminAt: new Int32Array(nz), TmaxAt: new Int32Array(nz),
    unmet: new Float64Array(nz), recovery: ZONES.map(() => []), infilCfmH: new Float64Array(nz), infilHours: 0,
    coolMild: new Float64Array(nz), hours,
  };
  if (record) {
    res.T = ZONES.map(() => new Float32Array(hours));
    res.Qh = ZONES.map(() => new Float32Array(hours));
    res.Qc = ZONES.map(() => new Float32Array(hours));
  }
  const mode = new Int8Array(nz);      // 0 free, 1 heat at setpoint, 2 cool at setpoint, 3 heat capped, 4 cool capped
  const rec = new Float64Array(nz).fill(-1);
  const zi = ZI;
  const sp = new Float64Array(nz), sc = new Float64Array(nz), gains = new Float64Array(nz);
  const Ginf = new Float64Array(nz), hourHeat = new Float64Array(nz), hourCool = new Float64Array(nz);
  const Q = new Float64Array(nz);
  const hvac = [true, false, true, true, false];
  const capH = ZONES.map(z => (!idealLoads && capHeat[z] != null ? capHeat[z] : Infinity));
  const capC = ZONES.map(z => (!idealLoads && capCool[z] != null ? capCool[z] : Infinity));

  for (let k = -warmup; k < hours; k++) {
    const i = ((k % wx.n) + wx.n) % wx.n;
    const acc = k >= 0;
    const day = Math.floor(i / 24), hod = i % 24;
    const dow = (day + dow0) % 7, how = dow * 24 + hod;
    const hdd = hddOverride ?? (wx.dayMeanF[day] < 65);
    const away = sched.away[day] === 1;
    hourBoundary(env, inp, wx, i, windOn, bnd);
    const T = bnd.T, V = bnd.V;

    // Setpoints and internal gains [Btu/h].
    sp.fill(-Infinity); sc.fill(Infinity); gains.fill(0);
    const shopOn = sched.shop[how] === 1, groundOn = sched.ground[how] === 1;
    sp[zi.shop] = shopOn && hdd ? inp.shop.occF : inp.shop.minF;
    sp[zi.ground] = groundOn && hdd ? inp.ground.occF : inp.ground.minF;
    sp[zi.upper] = away ? inp.upper.unoccMinF : inp.upper.heatF;
    if (!away) sc[zi.upper] = inp.upper.coolF;
    gains[zi.shop] = (shopOn ? inp.shop.gainsOn : inp.shop.gainsOff) * Z[zi.shop].A * 3.412;
    gains[zi.ground] = (groundOn ? inp.ground.gainsOn : inp.ground.gainsOff) * Z[zi.ground].A * 3.412;
    gains[zi.upper] = (away ? inp.upper.gainsOff : inp.upper.gainsOn) * Z[zi.upper].A * 3.412;

    // Recovery tracking: a setpoint step up starts a clock.
    for (const z of [zi.shop, zi.ground]) {
      const on = z === zi.shop ? shopOn : groundOn;
      const prevHow = (how + 167) % 168;
      const wasOn = (z === zi.shop ? sched.shop : sched.ground)[prevHow] === 1;
      if (on && hdd && !wasOn) rec[z] = 0;
      if (!on && rec[z] >= 0) { if (acc) res.recovery[z].push({ h: rec[z], met: false }); rec[z] = -1; }
    }

    // Leakage conductance per zone (ΔT from the start of the hour).
    for (let z = 0; z < nz; z++) {
      const r = infilG(Z[z], Ta[z] - T, V);
      Ginf[z] = r.G;
      if (acc) res.infilCfmH[z] += r.cfm;
    }
    if (acc) res.infilHours++;

    hourHeat.fill(0); hourCool.fill(0);
    for (let s = 0; s < sub; s++) {
      // Assemble.
      A0.fill(0); b0.fill(0);
      for (let z = 0; z < nz; z++) {
        const a = 2 * z, m = a + 1, Zz = Z[z], sol = bnd.sol[z];
        let Gs = Ginf[z], GTs = Ginf[z] * T;
        for (let q = 0; q < NG; q++) { Gs += bnd.G[z * NG + q]; GTs += bnd.GT[z * NG + q]; }
        A0[a * n + a] += Zz.Ca / dt + Gs + Zz.Ham;
        A0[a * n + m] -= Zz.Ham;
        A0[m * n + m] += Zz.Cm / dt + Zz.Ham;
        A0[m * n + a] -= Zz.Ham;
        b0[a] += Zz.Ca / dt * Ta[z] + GTs + 0.5 * gains[z] + 0.3 * sol;
        b0[m] += Zz.Cm / dt * Tm[z] + 0.5 * gains[z] + 0.7 * sol;
      }
      for (const l of links) {
        const a = 2 * l.ia, c = 2 * l.ib;
        A0[a * n + a] += l.G; A0[c * n + c] += l.G;
        A0[a * n + c] -= l.G; A0[c * n + a] -= l.G;
      }

      // Thermostat: iterate modes until consistent. A mode left over from
      // the previous step is dropped when its setpoint no longer exists.
      for (let z = 0; z < nz; z++) {
        if ((mode[z] === 2 || mode[z] === 4) && !isFinite(sc[z])) mode[z] = 0;
        if ((mode[z] === 1 || mode[z] === 3) && !isFinite(sp[z])) mode[z] = 0;
      }
      Q.fill(0);
      for (let it = 0; it < 8; it++) {
        A.set(A0); b.set(b0);
        for (let z = 0; z < nz; z++) {
          const a = 2 * z;
          if (mode[z] === 1 || mode[z] === 2) {
            for (let c = 0; c < n; c++) A[a * n + c] = 0;
            A[a * n + a] = 1; b[a] = mode[z] === 1 ? sp[z] : sc[z];
          } else if (mode[z] === 3) b[a] += capH[z];
          else if (mode[z] === 4) b[a] -= capC[z];
        }
        solveInPlace(A, b, x, n);
        let changed = false;
        for (let z = 0; z < nz; z++) {
          if (!hvac[z]) continue;
          const a = 2 * z, T_ = x[a];
          let q = 0;
          if (mode[z] === 1 || mode[z] === 2) {
            for (let c = 0; c < n; c++) q += A0[a * n + c] * x[c];
            q -= b0[a];
          } else if (mode[z] === 3) q = capH[z];
          else if (mode[z] === 4) q = -capC[z];
          Q[z] = q;
          const ch = capH[z], cc = capC[z];
          let next = mode[z];
          if (mode[z] === 0) { if (T_ < sp[z] - 1e-6) next = 1; else if (T_ > sc[z] + 1e-6) next = 2; }
          else if (mode[z] === 1) { if (q < 0) next = 0; else if (q > ch) next = 3; }
          else if (mode[z] === 2) { if (q > 0) next = 0; else if (-q > cc) next = 4; }
          else if (mode[z] === 3) { if (T_ > sp[z] + 1e-6) next = 1; }
          else if (mode[z] === 4) { if (T_ < sc[z] - 1e-6) next = 2; }
          if (next !== mode[z]) { mode[z] = next; changed = true; }
        }
        if (!changed) break;
      }

      for (let z = 0; z < nz; z++) {
        Ta[z] = x[2 * z]; Tm[z] = x[2 * z + 1];
        if (Q[z] > 0) hourHeat[z] += Q[z] / sub; else hourCool[z] -= Q[z] / sub;
        if (rec[z] >= 0) {
          rec[z] += dt;
          if (Ta[z] >= sp[z] - 1) { if (acc) res.recovery[z].push({ h: rec[z], met: true }); rec[z] = -1; }
        }
        if (!acc) continue;
        // Energy flows out of the zone, by group [Btu].
        const fl = res.flows[z];
        for (let q = 0; q < NG; q++) fl[q] += (bnd.G[z * NG + q] * Ta[z] - bnd.GT[z * NG + q]) * dt;
        fl[GIDX.air] += Ginf[z] * (Ta[z] - T) * dt;
        res.solar[z] += bnd.sol[z] * dt;
        res.internal[z] += gains[z] * dt;
      }
      if (acc) for (const l of links) {
        const q = l.G * (Ta[l.ia] - Ta[l.ib]) * dt;
        res.flows[l.ia][GIDX.zones] += q;
        res.flows[l.ib][GIDX.zones] -= q;
      }
    }

    if (!acc) continue;
    const mo = wx.month[i];
    for (let z = 0; z < nz; z++) {
      res.heat[z][mo] += hourHeat[z]; res.cool[z][mo] += hourCool[z];
      res.heatTot[z] += hourHeat[z]; res.coolTot[z] += hourCool[z];
      if (hourHeat[z] > res.peakHeat[z]) res.peakHeat[z] = hourHeat[z];
      if (hourCool[z] > res.peakCool[z]) { res.peakCool[z] = hourCool[z]; res.peakCoolAt[z] = k; }
      if (Ta[z] < res.Tmin[z]) { res.Tmin[z] = Ta[z]; res.TminAt[z] = k; }
      if (Ta[z] > res.Tmax[z]) { res.Tmax[z] = Ta[z]; res.TmaxAt[z] = k; }
      if (hvac[z] && Ta[z] < sp[z] - 1) res.unmet[z]++;
      if (T < sc[z] - 3) res.coolMild[z] += hourCool[z];
      if (record) { res.T[z][k] = Ta[z]; res.Qh[z][k] = hourHeat[z]; res.Qc[z][k] = hourCool[z]; }
    }
  }
  if (res.heatTot.some(Number.isNaN) || res.coolTot.some(Number.isNaN)) throw new Error('thermal simulation diverged');
  return res;
}

// ---------------------------------------------------------------- steady state

// Steady heat loss with no sun and no internal gains. Heated zones held at
// their in-use setpoints; the vestibule and south leg float.
export function steadyLoads(env, inp, { T, V, wd, windOn = true }) {
  const wx = {
    T: [T], T24: [T], V: [V / 1], WD: [wd], DNI: [0], DHI: [0], GHI: [0], alt: [-1], az: [0],
  };
  const bnd = newBoundary();
  hourBoundary(env, inp, wx, 0, windOn, bnd);
  const set = { shop: inp.shop.occF, ground: inp.ground.occF, upper: inp.upper.heatF };
  const nz = NZ;
  const Tz = ZONES.map(z => set[z] ?? T);
  const links = env.links.map(l => ({ ...l, ia: ZONES.indexOf(l.a), ib: ZONES.indexOf(l.b) }));
  const A = new Float64Array(nz * nz), b = new Float64Array(nz), x = new Float64Array(nz);
  let Ginf = new Float64Array(nz);
  for (let it = 0; it < 6; it++) {
    for (let z = 0; z < nz; z++) Ginf[z] = infilG(env.zones[ZONES[z]], Tz[z] - T, windOn ? V : 0).G;
    A.fill(0); b.fill(0);
    for (let z = 0; z < nz; z++) {
      let G = Ginf[z], GT = Ginf[z] * T;
      for (let q = 0; q < NG; q++) { G += bnd.G[z * NG + q]; GT += bnd.GT[z * NG + q]; }
      A[z * nz + z] += G; b[z] += GT;
    }
    for (const l of links) {
      A[l.ia * nz + l.ia] += l.G; A[l.ib * nz + l.ib] += l.G;
      A[l.ia * nz + l.ib] -= l.G; A[l.ib * nz + l.ia] -= l.G;
    }
    const A0 = A.slice(), b0 = b.slice();
    for (let z = 0; z < nz; z++) if (set[ZONES[z]] != null) {
      for (let c = 0; c < nz; c++) A[z * nz + c] = 0;
      A[z * nz + z] = 1; b[z] = set[ZONES[z]];
    }
    solveInPlace(A, b, x, nz);
    for (let z = 0; z < nz; z++) Tz[z] = x[z];
    if (it === 5) {
      const out = {};
      for (let z = 0; z < nz; z++) {
        const parts = {};
        for (const [g, gi] of Object.entries(GIDX)) parts[g] = bnd.G[z * NG + gi] * Tz[z] - bnd.GT[z * NG + gi];
        parts.air = Ginf[z] * (Tz[z] - T);
        parts.zones = 0;
        for (const l of links) {
          if (l.ia === z) parts.zones += l.G * (Tz[z] - Tz[l.ib]);
          if (l.ib === z) parts.zones += l.G * (Tz[z] - Tz[l.ia]);
        }
        let q = 0;
        for (let c = 0; c < nz; c++) q += A0[z * nz + c] * x[c];
        out[ZONES[z]] = { load: set[ZONES[z]] != null ? q - b0[z] : 0, T: Tz[z], parts, cfm: Ginf[z] / (1.08 * 0.822) };
      }
      return out;
    }
  }
}

// ---------------------------------------------------------------- design day

// ASHRAE clear-sky design day (2009 model, monthly taub/taud) repeated
// until periodic; returns a weather-like series for simulate().
export function designDay(wx, month, TmaxF, rangeF, windMph, windDir) {
  const FRAC = [0.88, 0.92, 0.95, 0.98, 1.00, 0.98, 0.91, 0.74, 0.55, 0.38, 0.23, 0.13,
    0.05, 0.00, 0.00, 0.06, 0.14, 0.24, 0.39, 0.50, 0.59, 0.68, 0.75, 0.82];
  const doy = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355][month];
  const tb = wx.taub[month], td = wx.taud[month];
  const ab = 1.219 - 0.043 * tb - 0.151 * td - 0.204 * tb * td;
  const ad = 0.202 + 0.852 * tb - 0.007 * td - 0.357 * tb * td;
  const E0 = 1367 * (1 + 0.033 * Math.cos(2 * Math.PI * (doy - 3) / 365));
  const lat = wx.lat * Math.PI / 180;
  const s = {
    n: 24, T: new Float64Array(24), T24: new Float64Array(24), V: new Float64Array(24).fill(windMph),
    WD: new Float64Array(24).fill(windDir), GHI: new Float64Array(24), DNI: new Float64Array(24),
    DHI: new Float64Array(24), alt: new Float64Array(24), az: new Float64Array(24),
    month: new Uint8Array(24).fill(month), day: new Uint16Array(24), dayMeanF: new Float64Array(1),
  };
  for (let h = 0; h < 24; h++) {
    // FRAC[h] is for the hour ending h+1; use it for the hour starting h.
    s.T[h] = TmaxF - FRAC[h] * rangeF;
    const [alt, az] = sunPosition(lat, wx.lon, wx.tz, doy, h + 0.5);
    s.alt[h] = alt; s.az[h] = az;
    if (alt > 0) {
      const deg = alt * 180 / Math.PI;
      const m = 1 / (Math.sin(alt) + 0.50572 * Math.pow(6.07995 + deg, -1.6364));
      const Eb = E0 * Math.exp(-tb * Math.pow(m, ab)), Ed = E0 * Math.exp(-td * Math.pow(m, ad));
      s.DNI[h] = Eb; s.DHI[h] = Ed; s.GHI[h] = Eb * Math.sin(alt) + Ed;
    }
  }
  const mean = s.T.reduce((a, v) => a + v, 0) / 24;
  s.T24.fill(mean); s.dayMeanF[0] = mean;
  return s;
}

// ---------------------------------------------------------------- run

const MMBTU = 1e6;

export function runModel(wxRaw, inp = INPUTS, p = DEFAULTS, { prepared } = {}) {
  const wx = prepared || prepareWeather(wxRaw);
  const env = buildEnvelope(p, inp);
  const dsn = wxRaw.design;
  const windOn = !!inp.site.wind;

  // Heating design: ASHRAE 99.6% dry bulb with its mean coincident wind.
  const Tdes = F(dsn.heating.db996C), Vdes = dsn.heating.wsDb996Ms * MPH, WDdes = dsn.heating.wdDb996;
  const heatDesign = steadyLoads(env, inp, { T: Tdes, V: Vdes, wd: WDdes, windOn });

  // Same temperature, stronger wind from the prevailing winter direction.
  const windCurve = Array.from({ length: 21 }, (_, j) => 2 * j).map(v => {
    const r = steadyLoads(env, inp, { T: Tdes, V: v, wd: 240, windOn: true });
    return { mph: v, ...Object.fromEntries(ZONES.map(z => [z, r[z].load])) };
  });

  // Worst TMY3 hour for steady heat loss (no sun, no gains): rank every hour
  // with a quick UA + leakage estimate, then solve the top candidates exactly.
  const ua = uaTable(env);
  const heated = ['shop', 'ground', 'upper'].map(z => ({
    Z: env.zones[z], set: z === 'upper' ? inp.upper.heatF : inp[z].occF,
    UA: GROUPS.reduce((s, [g]) => s + (g === 'zones' ? 0 : ua[z][g]), 0),
  }));
  const est = [];
  for (let i = 0; i < wx.n; i++) {
    const v = windOn ? wx.V[i] : 0;
    let e = 0;
    for (const h of heated) {
      const dT = h.set - wx.T[i];
      e += dT * (h.UA + 0.888 * h.Z.ELA * Math.sqrt(h.Z.Cs * Math.abs(dT) + h.Z.Cw * v * v));
    }
    est.push([e, i]);
  }
  est.sort((a, b) => b[0] - a[0]);
  let worst = { total: 0 };
  for (const [, i] of est.slice(0, 40)) {
    const r = steadyLoads(env, inp, { T: wx.T[i], V: wx.V[i], wd: wx.WD[i], windOn });
    const total = r.shop.load + r.ground.load + r.upper.load;
    if (total > worst.total) worst = { total, i, T: wx.T[i], V: windOn ? wx.V[i] : 0, WD: wx.WD[i], loads: r };
  }

  // Cooling design: ASHRAE 0.4% day in the hottest month, clear sky, ideal loads.
  const mo = dsn.cooling.hottestMonth - 1;
  const dd = designDay(wxRaw, mo, F(dsn.cooling.db004C), dsn.cooling.dailyRangeC * 1.8,
    windOn ? dsn.cooling.wsDb004Ms * MPH : 0, dsn.cooling.wdDb004);
  const ddSched = schedules(dd, { ...inp, upper: { ...inp.upper, unoccDays: 0 } });
  const coolDD = simulate(env, dd, inp, { hours: 24, warmup: 24 * 9, sched: ddSched, idealLoads: true, windOn, dow0: 3, hddOverride: false, record: true });
  const coolDesign = Object.fromEntries(ZONES.map((z, k) => [z, { load: coolDD.peakCool[k], hour: coolDD.peakCoolAt[k] }]));

  const capHeat = {}, capCool = {};
  // Heat reaches each zone through the AHU; its output caps a warm-up.
  for (const z of ['shop', 'ground', 'upper']) capHeat[z] = inp.plant.ahuHeatBtuh;
  capCool.upper = inp.plant.coolTons * 12000;

  const sched = schedules(wx, inp);
  const main = simulate(env, wx, inp, { capHeat, capCool, record: true, sched, windOn });
  const calm = windOn ? simulate(env, wx, inp, { capHeat, capCool, sched, windOn: false }) : null;

  // The center's airtightness is unknown: rerun at the tight and leaky ends.
  const range = {};
  for (const [k, v] of [['low', inp.center.achLow], ['high', inp.center.achHigh]]) {
    const i2 = JSON.parse(JSON.stringify(inp));
    i2.center.ach50 = v;
    const r2 = simulate(buildEnvelope(p, i2), wx, i2, { capHeat, capCool, sched, windOn });
    range[k] = { ach50: v, heatTot: r2.heatTot, coolTot: r2.coolTot, cost: costs(r2, i2) };
  }

  return {
    wx, env, ua, heatDesign, windCurve, worst, coolDesign, coolDD, capHeat, capCool, main, calm, range, sched, inp,
    cost: costs(main, inp),
    design: dsn, periods: wxRaw.periods, station: wxRaw.station, dataset: wxRaw.dataset,
  };
}

// The parts of a run the page needs, safe to post from a worker.
export function slimResult(r) {
  const { els, links, ...env } = r.env;
  return {
    env, ua: r.ua, heatDesign: r.heatDesign, windCurve: r.windCurve, worst: r.worst,
    coolDesign: r.coolDesign, capHeat: r.capHeat, capCool: r.capCool, design: r.design,
    periods: r.periods, station: r.station, dataset: r.dataset,
    main: r.main, calm: r.calm ? { heatTot: r.calm.heatTot, coolTot: r.calm.coolTot } : null,
    range: r.range, cost: r.cost,
    wx: { T: Float32Array.from(r.wx.T), V: Float32Array.from(r.wx.V), month: r.wx.month, dayMeanF: r.wx.dayMeanF },
    inp: r.inp,
    coolDesignDay: { T: Array.from(r.coolDD.T[3]), Qc: Array.from(r.coolDD.Qc[3]) },
  };
}

// Annual and monthly energy and cost of a simulate() result.
// Gas: heat delivered / boiler efficiency. Electric: Apollo compressor at its
// COP, plus the AHU fan and circulators for as long as the AHU runs, taken
// as heat delivered / AHU heating output and cooling / Apollo capacity.
export function costs(res, inp) {
  const pl = inp.plant, rt = inp.rates;
  const coolCap = pl.coolTons * 12000, distKW = (pl.fanW + pl.pumpW) / 1000;
  const keep = 1 - (pl.distLoss ?? 0);   // share of plant output that reaches the rooms
  const gasAt = m => (m != null && (rt.winterMonths ?? []).includes(m) ? rt.gasWinter ?? rt.gas : rt.gas);
  const zone = (heat, cool, m) => {
    const therms = heat / keep / pl.boilerEff / 1e5;
    const heatHours = heat / keep / pl.ahuHeatBtuh, coolHours = cool / keep / coolCap;
    const compKWh = cool / keep / (pl.coolCOP * 3412);
    const distKWh = (heatHours + coolHours) * distKW;
    const heatDistKWh = heatHours * distKW, coolDistKWh = coolHours * distKW;
    return {
      heat, cool, therms, compKWh, distKWh, heatHours, coolHours,
      gas: therms * gasAt(m),
      heatElec: heatDistKWh * rt.elec,
      coolElec: (compKWh + coolDistKWh) * rt.elec,
    };
  };
  const zones = {}, monthly = {};
  ZONES.forEach((z, k) => {
    zones[z] = zone(res.heatTot[k], res.coolTot[k]);
    monthly[z] = Array.from({ length: 12 }, (_, m) => zone(res.heat[k][m], res.cool[k][m], m));
    zones[z].gas = monthly[z].reduce((a, x) => a + x.gas, 0);   // each month at its season's rate
  });
  const sum = f => ZONES.reduce((s, z) => s + f(zones[z]), 0);
  const t = {
    heat: sum(z => z.heat), cool: sum(z => z.cool), therms: sum(z => z.therms),
    compKWh: sum(z => z.compKWh), distKWh: sum(z => z.distKWh),
    heatHours: sum(z => z.heatHours), coolHours: sum(z => z.coolHours),
    gas: sum(z => z.gas), heatElec: sum(z => z.heatElec), coolElec: sum(z => z.coolElec),
  };
  t.kWh = t.compKWh + t.distKWh;
  t.heating = t.gas + t.heatElec;
  t.cooling = t.coolElec;
  t.total = t.heating + t.cooling;
  t.fixed = 12 * (rt.gasMonthly + rt.elecMonthly);
  return { zones, monthly, totals: t };
}

// ---------------------------------------------------------------- sensitivity

// Unknowns worth bracketing. Each is set to a better and a worse case with
// everything else held at the inputs; `sim` cases need a new year simulated,
// the rest only change the cost arithmetic.
const scaleGains = (i, k) => {
  for (const z of ['shop', 'ground', 'upper']) { i[z].gainsOn *= k; i[z].gainsOff *= k; }
};
export const SENSITIVITY = [
  { key: 'center', label: 'Center airtightness', fmt: v => `ACH50 ${v}`, better: i => i.center.achLow, worse: i => i.center.achHigh, set: (i, v) => { i.center.ach50 = v; }, sim: true },
  { key: 'framing', label: 'Foam effectiveness in walls', fmt: v => `×${v}`, better: () => 1, worse: () => 0.4, set: (i, v) => { i.framing = v; }, sim: true },
  { key: 'gas', label: 'Gas price over the winter', fmt: v => `$${v.toFixed(2)}/therm`, better: i => i.rates.gasWinter ?? i.rates.gas, worse: i => Math.max(i.rates.gasWinter ?? i.rates.gas, 0.80), set: (i, v) => { i.rates.gasWinter = v; }, sim: false },
  { key: 'dist', label: 'Duct and piping losses', fmt: v => `${Math.round(v * 100)}%`, better: () => 0, worse: () => 0.2, set: (i, v) => { i.plant.distLoss = v; }, sim: false },
  { key: 'boiler', label: 'Boiler seasonal efficiency', fmt: v => `${Math.round(v * 100)}%`, better: () => 0.93, worse: () => 0.82, set: (i, v) => { i.plant.boilerEff = v; }, sim: false },
  { key: 'windows', label: 'Window U-factor', fmt: v => `U-${v}`, better: () => 0.3, worse: () => 0.65, set: (i, v) => { i.glass.windowU = v; }, sim: true },
  { key: 'gains', label: 'Lights, appliances, people', fmt: v => `${v}× inputs`, better: () => 1.5, worse: () => 0.5, set: (i, v) => scaleGains(i, v), sim: true },
  { key: 'slab', label: 'Slab edge', fmt: v => `F-${v}`, better: () => 0.5, worse: () => 0.9, set: (i, v) => { i.slab.F = v; }, sim: true },
  { key: 'shop', label: 'Shop airtightness', fmt: v => `ACH50 ${v}`, better: () => 1, worse: () => 3, set: (i, v) => { i.shop.ach50 = v; }, sim: true },
];

// Annual heating and cooling cost with one unknown moved to its better or
// worse case. `base` is the runModel() result for the same inputs.
export function sensitivityCase(c, which, base, p = DEFAULTS) {
  const inp = base.inp, v = c[which](inp);
  const i2 = JSON.parse(JSON.stringify(inp));
  c.set(i2, v);
  let total;
  if (!c.sim) total = costs(base.main, i2).totals.total;
  else if (c.key === 'center') total = base.range[which === 'better' ? 'low' : 'high'].cost.totals.total;
  else {
    const res = simulate(buildEnvelope(p, i2), base.wx, i2,
      { capHeat: base.capHeat, capCool: base.capCool, sched: base.sched, windOn: !!i2.site.wind });
    total = costs(res, i2).totals.total;
  }
  return { v, label: c.fmt(v), total };
}
