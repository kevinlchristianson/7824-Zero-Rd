// Solar, heat pump and net-metering economics for 7824 Zero Rd.
//
// Hourly on the Casper TMY3 year:
//   - PV output from real sun (DNI/DHI/GHI) on a fixed ground mount, with
//     cell temperature from air temperature and wind, and inverter clipping.
//   - Loads from the thermal model (heating and cooling by hour), domestic
//     electricity and domestic hot water.
//   - Heating either from the gas boiler (today) or from air-to-water heat
//     pumps with the boiler as backup.
//   - Rocky Mountain Power net metering: monthly kWh netting, credits carried
//     forward, leftover credit paid at avoided cost at the annual true-up.
// Defaults come from the owner's "Casper Solar Sizing Model" spreadsheet
// unless marked otherwise.

import { runModel, prepareWeather, INPUTS as THERMAL, ZONES } from './thermal.js';

export const SOLAR_INPUTS = {
  pv: {
    tilt: 40, azimuth: 180,          // assumed: fixed ground mount facing south
    losses: 0.10,                    // assumed: soiling, snow, wiring, mismatch
    tempCoef: -0.0035,               // assumed: per °C, mono PERC
    inverter: 'auto',                // an id from INVERTERS, or 'auto' for the best value
    albedo: 0.25,                    // assumed: dry grass, some snow
  },
  // Air-to-water heat pumps (none bought yet). The COP and capacity curves
  // are the 6-ton Apollo's from the sheet; the 3.5-ton is assumed to follow
  // the same COPs with capacity scaled by tons.
  hp: {
    cop47: 3.8, cop17: 2.5, cop5: 1.9, derate: 0.9, minT: -13,   // sheet (Apollo 6T)
    cap47: 72000, cap10: 39200,                                  // sheet, 6-ton, Btu/h
    // Water temperature: the sheet's COPs are taken as rated at 95 °F supply
    // water; hotter water costs COP and capacity. The buffer tank follows the
    // hydronic pack's outdoor reset (sheet M-4), capped at 120 °F for the floor.
    ratedWaterF: 95,                 // assumed
    copPerF: 0.012, capPerF: 0.006,  // assumed: share lost per °F above rated
    reset: { lowF: 85, lowAtF: 60, highF: 120, highAtF: -10 },   // owner: schematic M-4
    preheatApproachF: 10,            // assumed: buffer lower coil to cold water
    units: {
      t35: { name: '3.5-ton', tons: 3.5, cost: 4138, coolCop: 4.6 },   // MBTEK list less 20% (owner); owner cooling COP
      t60: { name: '6-ton', tons: 6, cost: 5816, coolCop: 3.8 },       // MBTEK list less 20% (owner); sheet EER 13
    },
    install: 1500,                   // assumed, per unit: pad, line set, wiring, glycol
    buffer: 2890,                    // MBTEK BF250 dual-coil, list less 20%
    controls: 1500,                  // assumed: HBX ECO-0600, V-1..V-4, sensors, P-3 (pack M-3/M-5)
    shopHeater: 1600,                // assumed: MBTEK commercial hydronic unit heater, installed (only if shop.heater = 'navien')
    option: 'auto',                  // an id from HP_OPTIONS, or 'auto' for the lowest 25-year cost
    heat: 'auto',                    // a key of HP_MODES, or 'auto' for the cheapest
    ahus: 'auto',                    // 1, 2, or 'auto'
  },
  // Upper-level radiant floor (schematic M-1): PEX suspended in the truss
  // bays on aluminum plates, R-19 below. It carries the upper level up to
  // what it can put out at the tank temperature; the AHU's upstairs damper
  // covers the rest. With a second AHU the upper level is heated by air and
  // the floor is left off.
  floor: { areaFt2: 3168, btuPerFt2F: 0.35, downLoss: 0.08 },   // area from M-1; output and loss assumed
  boilerEff: 0.93,                   // assumed: Navien condensing on ≤120 °F return
  ahu2: { cost: 2560, install: 3000 },             // MBTEK 3.5-ton AHU list less 20%; ducts and install assumed
  // The shop is heated only on demand, fast, with gas (owner): either the
  // existing Modine, or a hydronic unit heater fed max-temperature water
  // straight from the Navien in burst mode (non-condensing at that
  // temperature). The heat pump never heats the shop.
  shop: { heater: 'modine', navienBurstEff: 0.87 },   // owner; burst efficiency assumed
  modine: { eff: 0.82, resale: 2500 },             // separated-combustion rating; resale assumed (half of new)
  dhw: { galPerDay: 60, setF: 120, eff: 0.90 },  // assumed: four people, about 15 gal each
  domestic: { kWhPerDay: 47, indoor: 0.7 },       // sheet
  rates: {
    elec: 0.1016, avoided: 0.03, elecFixed: 34,    // sheet
    gas: 0.58, gasFixed: 33,                       // sheet
    escalation: 0.033, degradation: 0.005,         // sheet
    trueUpMonth: 11,                               // sheet: year-end (December)
  },
  capex: {
    pvPerKw: 590, fixed: 4000,                     // sheet
    batteryPerKwh: 220, batteryKwh: 30, batteryRte: 0.9, batteryKw: 15, // sheet
    incentive: 0,                                  // share of capex refunded
  },
  finance: { loanRate: 0.08, loanYears: 10, horizon: 25, discount: 0.08 },   // sheet; discount = loan rate
  // Inverter choices. ac and dc are per unit (kW); cost per unit; perKw is
  // per kW of panels (optimizers, microinverters); fixed is per system;
  // idleW is what each unit draws around the clock. Prices are 2026 retail
  // listings unless marked; efficiencies are CEC-weighted.
  inverters: {
    eg4_18kpv: { name: 'EG4 18kPV', kind: 'hybrid', ac: 12, dc: 18, cost: 4200, eff: 0.969, idleW: 70, battery: true },   // sheet price; 70 W idle from EG4
    flexboss21: { name: 'EG4 FlexBOSS21', kind: 'hybrid', ac: 16, dc: 21, cost: 4199, eff: 0.965, idleW: 70, battery: true },   // eff and idle assumed
    flexboss18: { name: 'EG4 FlexBOSS18', kind: 'hybrid', ac: 13, dc: 18, cost: 3499, eff: 0.965, idleW: 70, battery: true },   // eff and idle assumed
    eg4_12kpv: { name: 'EG4 12kPV', kind: 'hybrid', ac: 8, dc: 12, cost: 3499, eff: 0.965, idleW: 60, battery: true },         // eff and idle assumed
    solaredge: { name: 'SolarEdge SE11400H', kind: 'string', ac: 11.4, dc: 17.6, cost: 2800, perKw: 130, eff: 0.99, idleW: 3, battery: false },  // perKw: S440 optimizers, assumed
    sma77: { name: 'SMA Sunny Boy 7.7', kind: 'string', ac: 7.68, dc: 11.5, cost: 1706, eff: 0.965, idleW: 1, battery: false },
    enphase: { name: 'Enphase IQ8HC', kind: 'micro', acRatio: 0.873, perKw: 450, fixed: 1000, eff: 0.97, idleW: 0, battery: false },  // 384 VA per 440 W panel; combiner assumed
  },
  nemCapKwAC: 25,                    // Wyoming net-metering limit (verify with RMP)
  backup: 'boiler',                  // 'boiler' keeps gas; 'strips' = AHU 10 kW electric
};

const BTU_KWH = 3412;
const DOMESTIC_SHAPE = norm([30, 27, 25, 25, 26, 30, 38, 45, 45, 42, 40, 40, 40, 39, 39, 41, 46, 54, 60, 60, 56, 50, 42, 35]);
const DHW_SHAPE = norm([1, 0.5, 0.5, 0.5, 1, 3, 8, 9, 8, 6, 5, 4, 4, 3.5, 3.5, 4, 5, 7, 8, 7, 6, 4.5, 3, 2]);
function norm(a) { const s = a.reduce((x, y) => x + y, 0); return a.map(v => v / s); }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- PV

// DC output per kW of panels, before the inverter [kW/kW], hourly.
export function pvPerKw(wx, pv) {
  const n = wx.n, out = new Float64Array(n);
  const tilt = pv.tilt * Math.PI / 180, paz = pv.azimuth * Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const alt = wx.alt[i], az = wx.az[i];
    const dni = wx.DNI[i], dhi = wx.DHI[i], ghi = wx.GHI[i];
    if (ghi <= 0) continue;
    const cosInc = alt > 0 ? Math.sin(alt) * Math.cos(tilt) + Math.cos(alt) * Math.sin(tilt) * Math.cos(az - paz) : 0;
    const iam = cosInc > 0 ? Math.max(0, 1 - 0.05 * (1 / cosInc - 1)) : 0;
    const beam = cosInc > 0 ? dni * cosInc * iam : 0;
    const poa = beam + dhi * (1 + Math.cos(tilt)) / 2 + ghi * pv.albedo * (1 - Math.cos(tilt)) / 2;
    const Ta = (wx.T[i] - 32) / 1.8, ws = wx.V[i] / 2.23694;
    const Tc = Ta + poa / (25 + 6.84 * ws);             // Faiman cell temperature
    const dc = poa / 1000 * (1 + pv.tempCoef * (Tc - 25)) * (1 - pv.losses);
    out[i] = Math.max(0, dc);
  }
  return out;
}

// ---------------------------------------------------------------- loads

const copAt = (hp, T) => {
  const c = T >= 17 ? hp.cop17 + (T - 17) * (hp.cop47 - hp.cop17) / 30 : hp.cop5 + (T - 5) * (hp.cop17 - hp.cop5) / 12;
  return clamp(hp.derate * c, 1, hp.cop47 * 1.3);
};
const capAt = (hp, T) => Math.max(0, hp.cap10 + (T - 10) * (hp.cap47 - hp.cap10) / 37);


// The heat pump setups to compare. Cooling runs through the one 6-ton AHU,
// so no setup can deliver more than 6 tons of cooling.
export const HP_OPTIONS = {
  c35: { label: 'One 3.5-ton', units: ['t35'] },
  h60: { label: 'One 6-ton', units: ['t60'] },
  both: { label: '3.5-ton + 6-ton', units: ['t35', 't60'] },
  two60: { label: 'Two 6-tons', units: ['t60', 't60'] },
};
export const HP_MODES = {
  smart: 'heats when that beats gas: on solar credit that would be paid out, or when its COP beats gas',
  hp: 'heats first whenever it can, boiler backs up',
  cool: 'cools only; the boiler heats',
};
const AHU_BTUH = { 1: 72000, 2: 72000 + 42000 };   // 6-ton AHU, plus a 3.5-ton

// Hourly thermal loads from the heating & cooling model, with the upper
// level's internal gains taken from the domestic electricity use. Cooling is
// left uncapped here; each heat pump setup applies its own capacity.
export function thermalLoads(wxRaw, thermalInputs, s, prepared) {
  const inp = JSON.parse(JSON.stringify(thermalInputs));
  const upperA = 48 * 68;
  const w = s.domestic.kWhPerDay * s.domestic.indoor / 24 * 1000 / upperA;   // W/ft²
  inp.upper.gainsOn = w; inp.upper.gainsOff = w * 0.3;
  inp.plant.coolTons = 30;
  const r = runModel(wxRaw, inp, undefined, { prepared });
  const n = r.wx.n, keep = 1 - (inp.plant.distLoss ?? 0);
  const heat = new Float64Array(n), cool = new Float64Array(n), zone = {};
  for (const z of ['shop', 'ground', 'upper']) {
    const k = ZONES.indexOf(z), q = zone[z] = new Float64Array(n);
    for (let i = 0; i < n; i++) { q[i] = r.main.Qh[k][i] / keep; heat[i] += q[i]; cool[i] += r.main.Qc[k][i] / keep; }
  }
  return { heat, cool, zone, plant: inp.plant, costs: r.cost, wx: r.wx };
}

// Everything that does not depend on the solar array or the heat pumps:
// hourly household electricity, hot water, space heat and cooling demand.
export function buildContext(wxRaw, s = SOLAR_INPUTS, thermalInputs = THERMAL, prepared = prepareWeather(wxRaw), th = thermalLoads(wxRaw, thermalInputs, s, prepared)) {
  const wx = prepared, n = wx.n;
  const dom = new Float64Array(n), dhw = new Float64Array(n), tin = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.floor(i / 24), h = i % 24;
    dom[i] = s.domestic.kWhPerDay * DOMESTIC_SHAPE[h];
    // Hot water: inlet water follows the season (≈ 42–58 °F in Casper).
    tin[i] = 50 + 8 * Math.cos(2 * Math.PI * (d - 240) / 365);
    dhw[i] = s.dhw.galPerDay * DHW_SHAPE[h] * 8.34 * (s.dhw.setF - tin[i]);       // Btu this hour
  }
  return {
    n, month: wx.month, T: wx.T, dom, dhw, tin, space: th.heat, cool: th.cool, zone: th.zone, plant: th.plant,
    pvDC: pvPerKw(wx, s.pv), s, m: pickInverter(s), thermal: th, cache: {},
  };
}

// Hourly electricity and gas for one heat pump setup, heating mode and AHU
// count. key: 'today' (no heat pump, no cooling, one AHU, floor on) or
// '<option>.<mode>.<ahus>'.
export function loadsFor(ctx, key) {
  if (ctx.cache[key]) return ctx.cache[key];
  const s = ctx.s, hp = s.hp, pl = ctx.plant, n = ctx.n, R0 = hp.reset, bEff = s.boilerEff ?? pl.boilerEff;
  const tankF = T => clamp(R0.lowF + (R0.lowAtF - T) * (R0.highF - R0.lowF) / (R0.lowAtF - R0.highAtF), R0.lowF, R0.highF);
  const [opt, mode, ahuS] = key === 'today' ? [null, 'cool', '1'] : key.split('.');
  const ahus = Number(ahuS);
  const units = opt ? HP_OPTIONS[opt].units.map(u => hp.units[u]) : [];
  const tons = units.reduce((a, u) => a + u.tons, 0);
  const coolUnits = [...units].sort((a, b) => b.coolCop - a.coolCop);
  const coolRate = Math.min(tons * 12000, AHU_BTUH[ahus]), distKW = (pl.fanW + pl.pumpW) / 1000;
  const floorOn = ahus === 1, down = s.floor.downLoss, fK = s.floor.btuPerFt2F * s.floor.areaFt2;
  const copF = Tw => Math.max(0.3, 1 - hp.copPerF * (Tw - hp.ratedWaterF));
  const capF = Tw => Math.max(0.3, 1 - hp.capPerF * (Tw - hp.ratedWaterF));
  const heatHp = mode === 'hp', smart = mode === 'smart' && tons > 0;
  const r = s.rates, beGas = r.elec / r.gas;       // therms saved per kWh at which heat pump heat costs what gas does
  const cand = smart ? Array.from({ length: 12 }, () => []) : null;
  let alwaysHeat = 0;
  const elec = new Float64Array(n), gas = new Float64Array(n);
  let heatTot = 0, hpHeat = 0, backupElec = 0, unmet = 0, coolTot = 0, coolUnmet = 0, coolUnmetHrs = 0, floorLoss = 0, floorBtu = 0;
  for (let i = 0; i < n; i++) {
    const T = ctx.T[i], dhw = ctx.dhw[i], cool = ctx.cool[i], Tw = tankF(T);
    // Where the heat goes: the floor carries the upper level up to what it
    // puts out at the tank temperature, and leaks some down, which the
    // ground level uses when it needs heat.
    const upFloor = floorOn ? Math.min(ctx.zone.upper[i], fK * Math.max(0, Tw - 5 - 68)) : 0;
    const floorOut = upFloor / (1 - down), leak = floorOut - upFloor;
    const groundAir = Math.max(0, ctx.zone.ground[i] - leak);
    floorLoss += Math.max(0, leak - ctx.zone.ground[i]);
    // Today the gas Modine heats the shop directly, with no pipes to lose heat
    // through; the heat pump plans move it onto the buffer.
    const shopQ = ctx.zone.shop[i];
    const air = groundAir + ctx.zone.upper[i] - upFloor;
    // Hot water: the combi heats it, from cold water the buffer's lower coil
    // has preheated whenever the tank is warm (not while it's chilled).
    const pre = cool > 0 ? 0 : dhw * clamp((Math.min(s.dhw.setF, Tw - hp.preheatApproachF) - ctx.tin[i]) / (s.dhw.setF - ctx.tin[i]), 0, 1);
    // Cooling: the most efficient unit first, up to what the AHUs can move.
    const served = Math.min(cool, coolRate);
    coolTot += cool;
    if (cool - served > 100) { coolUnmet += cool - served; coolUnmetHrs++; }
    let rem = served, e = ctx.dom[i];
    for (const u of coolUnits) { const q = Math.min(rem, u.tons * 12000); e += q / (u.coolCop * BTU_KWH); rem -= q; }
    if (served > 0) e += served / coolRate * distKW;
    e += air / pl.ahuHeatBtuh * distKW;
    // Heating: the heat pumps take the loads they serve, coolest water first,
    // sharing the hour; the rest falls to the backup.
    // Everything the heat pumps make goes through the buffer at one
    // temperature: the tank's.
    const loads = [['air', air], ['floor', floorOut], ['pre', pre]];
    let frac = T >= hp.minT && (heatHp || smart) && tons > 0 ? 1 : 0, left = { air, floor: floorOut, pre, dhw: dhw - pre };
    const cap0 = capAt(hp, T) * tons / 6, cop0 = copAt(hp, T);
    for (const [k, q] of loads) {
      if (frac <= 0 || q <= 0) continue;
      const cap = cap0 * capF(Tw), got = Math.min(q, frac * cap);
      const kwh = got / (Math.max(1, cop0 * copF(Tw)) * BTU_KWH);
      frac -= got / cap;
      if (smart) {
        // A candidate: this much heat pump electricity in place of this much gas.
        const th = got / (k === 'pre' ? s.dhw.eff : bEff) / 1e5;
        if (th / kwh >= beGas) { left[k] -= got; hpHeat += got; e += kwh; alwaysHeat += got; }
        else cand[ctx.month[i]].push([th / kwh, kwh, th, got]);
        continue;
      }
      left[k] -= got; hpHeat += got; e += kwh;
    }
    let g = 0;
    if (heatHp && s.backup === 'strips') {
      const r2 = left.air + left.floor + left.pre + left.dhw, strip = Math.min(r2, 10 * BTU_KWH * ahus);
      e += strip / BTU_KWH; backupElec += strip / BTU_KWH; unmet += r2 - strip;
    } else g = ((left.air + left.floor) / bEff + (left.pre + left.dhw) / s.dhw.eff) / 1e5;
    // The shop, always on gas.
    g += s.shop.heater === 'navien' ? shopQ / s.shop.navienBurstEff / 1e5 : shopQ * (1 - (pl.distLoss ?? 0)) / s.modine.eff / 1e5;
    e += s.shop.heater === 'navien' ? shopQ / pl.ahuHeatBtuh * distKW : 0;
    heatTot += air + floorOut + dhw + shopQ; floorBtu += upFloor;
    elec[i] = e; gas[i] = g;
  }
  const cost = !opt ? 0 : units.reduce((a, u) => a + u.cost + hp.install, 0) + hp.buffer + hp.controls
    + (ahus === 2 ? s.ahu2.cost + s.ahu2.install : 0);
  // Smart mode: per month, the remaining candidates best first, as running
  // totals of kWh used, therms saved and heat moved.
  let flex = null;
  if (smart) flex = cand.map(list => {
    list.sort((a, b) => b[0] - a[0]);
    const kwh = new Float64Array(list.length + 1), th = new Float64Array(list.length + 1), btu = new Float64Array(list.length + 1);
    list.forEach(([, k, t, q], j) => { kwh[j + 1] = kwh[j] + k; th[j + 1] = th[j] + t; btu[j + 1] = btu[j] + q; });
    return { kwh, th, btu };
  });
  return (ctx.cache[key] = {
    key, opt, mode, ahus, elec, gas, tons, cost, hpShare: hpHeat / heatTot, heatTot, backupElec, unmet,
    coolTot, coolUnmet, coolUnmetHrs, floorLoss, floorShare: floorBtu / Math.max(1, ctx.zone.upper.reduce((a, b) => a + b, 0)), flex,
  });
}

// ---------------------------------------------------------------- one year

// Inverter helpers. A microinverter system counts as one "unit" whose AC
// output follows the panels.
export const invOf = (s, id) => s.inverters[id];
const acOf = (M, cfg) => (M.acRatio ? cfg.kw * M.acRatio : cfg.inv * M.ac);
export const dcPer = (s, M) => (M.acRatio ? Math.floor(s.nemCapKwAC / M.acRatio + 1e-9) : M.dc);
export const maxInv = (s, M) => (M.acRatio ? 1 : Math.max(1, Math.floor(s.nemCapKwAC / M.ac + 1e-9)));
const pickInverter = s => (s.pv.inverter in s.inverters ? s.pv.inverter : Object.keys(s.inverters)[0]);
export const invCost = (M, cfg) => (cfg.kw > 0 ? cfg.inv * (M.cost ?? 0) + (M.fixed ?? 0) + cfg.kw * (M.perKw ?? 0) : 0);
const unitsFor = (s, M, kw) => (kw === 0 ? 0 : M.acRatio ? 1 : Math.ceil(kw / dcPer(s, M) - 1e-9));

// cfg: { kw (DC), inv (count), m (inverter id), load (loadsFor key), battery (bool) }
export function evaluate(ctx, cfg) {
  const s = ctx.s, r = s.rates, c = s.capex, n = ctx.n;
  const L = loadsFor(ctx, cfg.load ?? 'today');
  const M = invOf(s, cfg.m ?? ctx.m);
  const ac = acOf(M, cfg), eff = M.eff, idle = cfg.kw > 0 ? cfg.inv * M.idleW / 1000 : 0;
  const monImp = new Float64Array(12), monExp = new Float64Array(12), monProd = new Float64Array(12), monLoad = new Float64Array(12);
  let soc = 0, prod = 0;
  const bCap = cfg.battery ? c.batteryKwh : 0, rt = Math.sqrt(c.batteryRte);
  for (let i = 0; i < n; i++) {
    const p = Math.min(cfg.kw * ctx.pvDC[i] * eff, ac), load = L.elec[i] + idle, m = ctx.month[i];
    prod += p; monProd[m] += p; monLoad[m] += load;
    let net = load - p;
    if (bCap) {
      if (net < 0) { const ch = Math.min(-net, c.batteryKw, (bCap - soc) / rt); soc += ch * rt; net += ch; }
      else if (net > 0) { const dis = Math.min(net, c.batteryKw, soc * rt); soc -= dis / rt; net -= dis; }
    }
    if (net > 0) monImp[m] += net; else monExp[m] -= net;
  }
  // Smart heat pump heating: spend credit that would otherwise be paid out
  // at the true-up on heat, best therms-per-kWh first, without ever making a
  // month buy power it wouldn't have.
  let flexTherms = 0, flexBtu = 0;
  const flexGas = new Float64Array(12);
  if (L.flex) {
    const order = Array.from({ length: 12 }, (_, j) => (r.trueUpMonth + 1 + j) % 12);
    const R = new Float64Array(12);
    let b = 0;
    order.forEach((m, j) => { b = Math.max(0, b - (monImp[m] - monExp[m])); R[j] = b; });
    for (let j = 11; j >= 0; j--) {
      let x = Infinity;
      for (let k = j; k < 12; k++) x = Math.min(x, R[k]);
      const F = L.flex[order[j]], n1 = F.kwh.length - 1;
      x = Math.min(x, F.kwh[n1]);
      if (x <= 1e-6) continue;
      // Therms and heat for x kWh along the running totals.
      let lo = 0, hi = n1;
      while (hi - lo > 1) { const md = (lo + hi) >> 1; if (F.kwh[md] <= x) lo = md; else hi = md; }
      const t = F.kwh[hi] > F.kwh[lo] ? (x - F.kwh[lo]) / (F.kwh[hi] - F.kwh[lo]) : 0;
      const th = F.th[lo] + t * (F.th[hi] - F.th[lo]), q = F.btu[lo] + t * (F.btu[hi] - F.btu[lo]);
      const m = order[j];
      // More use this month: first out of what it exported, then imports.
      const fromExp = Math.min(x, monExp[m]); monExp[m] -= fromExp; monImp[m] += x - fromExp; monLoad[m] += x;
      for (let k = j; k < 12; k++) R[k] -= x;
      flexTherms += th; flexBtu += q; flexGas[m] += th;
    }
  }
  // Net metering: two passes so the credit bank reaches steady state.
  let bank = 0, elecBill = 0, paidOut = 0, bought = 0;
  const monBill = new Float64Array(12), monBank = new Float64Array(12);
  for (let pass = 0; pass < 2; pass++) {
    for (let m = 0; m < 12; m++) {
      const net = monImp[m] - monExp[m];
      let kwhBought = 0;
      if (net >= 0) { const use = Math.min(bank, net); bank -= use; kwhBought = net - use; }
      else bank -= net;
      let credit = 0;
      if (m === r.trueUpMonth) { credit = bank * r.avoided; bank = 0; }
      if (pass === 1) {
        monBill[m] = kwhBought * r.elec + r.elecFixed - credit;
        monBank[m] = bank;
        elecBill += monBill[m]; paidOut += credit; bought += kwhBought;
      }
    }
  }
  let therms = 0;
  const monGas = new Float64Array(12);
  for (let i = 0; i < n; i++) { therms += L.gas[i]; monGas[ctx.month[i]] += L.gas[i]; }
  therms -= flexTherms; for (let m = 0; m < 12; m++) monGas[m] -= flexGas[m];
  const gasService = therms > 0.5 || s.backup !== 'strips';
  const gasBill = therms * r.gas + (gasService ? 12 * r.gasFixed : 0);
  const solarCapex = (cfg.kw > 0 ? cfg.kw * c.pvPerKw + c.fixed : 0) + invCost(M, cfg) + (cfg.battery ? c.batteryKwh * c.batteryPerKwh : 0);
  return {
    cfg, prod, imp: sumA(monImp), exp: sumA(monExp), bought, paidOut, therms, gasService,
    hpShare: L.heatTot ? L.hpShare + flexBtu / L.heatTot : 0,
    elecBill, gasBill, total: elecBill + gasBill,
    capex: solarCapex * (1 - c.incentive) + L.cost, solarCapex: solarCapex * (1 - c.incentive), hpCapex: L.cost,
    monProd, monLoad, monImp, monExp, monBill, monBank, monGas,
    loadKWh: sumA(monLoad),
  };
}
const sumA = a => a.reduce((x, y) => x + y, 0);

// Present value of $1 a year growing at g, over the horizon.
const pvf = (s, g) => { let v = 0; for (let y = 1; y <= s.finance.horizon; y++) v += (1 + g) ** (y - 1) / (1 + s.finance.discount) ** y; return v; };

// Payback and long-run value of a result against a baseline result: the
// extra cost against the bills it saves.
export function economics(res, baseline, s) {
  const f = s.finance, r = s.rates;
  const cost = res.capex - baseline.capex, save1 = baseline.total - res.total;
  const g = r.escalation - (res.cfg.kw > 0 ? r.degradation : 0);
  let cum = 0, payback = null, gain = -cost, npv = -cost;
  for (let y = 1; y <= f.horizon; y++) {
    const sy = save1 * (1 + g) ** (y - 1);
    gain += sy;
    npv += sy / (1 + f.discount) ** y;
    if (payback == null && cum + sy >= cost) payback = y - 1 + (cost - cum) / sy;
    cum += sy;
  }
  const i = f.loanRate / 12, nPay = f.loanYears * 12;
  const loanYear = cost > 0 ? 12 * cost * i / (1 - (1 + i) ** -nPay) : 0;
  return { cost, save1, payback: cost > 0 && save1 > 0 ? payback : null, simple: save1 > 0 ? cost / save1 : null, gain, npv, loanYear, cash1: save1 - loanYear };
}

// 25-year cost of owning a setup: everything bought up front plus the
// present value of its bills. The solar share of the savings degrades.
export function lifeCost(res, res0, s) {
  const r = s.rates;
  return res.capex + res0.total * pvf(s, r.escalation) - (res0.total - res.total) * pvf(s, r.escalation - (res.cfg.kw > 0 ? r.degradation : 0));
}

// ---------------------------------------------------------------- plans

// A purchase order for solar on top of one heat pump setup: repeatedly take
// the addition with the shortest payback on its own extra cost, until
// nothing left is worth more than it costs.
export function ladder(ctx, load) {
  const s = ctx.s, H = s.finance.horizon, M = invOf(s, ctx.m), dcMax = dcPer(s, M), nMax = maxInv(s, M);
  const start = { kw: 0, inv: 0, load, battery: false };
  const baseline = evaluate(ctx, start);
  let cur = { cfg: start, res: baseline };
  const steps = [], rejected = [];
  const f = pvf(s, s.rates.escalation - s.rates.degradation);
  for (let guard = 0; guard < 60; guard++) {
    const moves = [], c0 = cur.cfg;
    const add = (label, kind, cfg, extra = {}) => {
      const res = evaluate(ctx, cfg);
      const dCap = res.capex - cur.res.capex, dSave = cur.res.total - res.total;
      if (dSave > 1 && dCap > 0) moves.push({ label, kind, cfg, res, dCap, dSave, pb: dCap / dSave, dNpv: dSave * f - dCap, ...extra });
    };
    // Panels: in 1 kW steps on existing inverters, or a new inverter with
    // the best fill of panels.
    if (c0.inv > 0 && c0.kw + 1 <= c0.inv * dcMax + 1e-9) add('+1 kW of panels', 'pv', { ...c0, kw: c0.kw + 1 });
    if (c0.inv < nMax) {
      let best = null;
      for (let k = 2; k <= dcMax; k++) {
        const cfg = { ...c0, inv: c0.inv + 1, kw: c0.kw + k };
        const res = evaluate(ctx, cfg), dCap = res.capex - cur.res.capex, dSave = cur.res.total - res.total;
        if (dSave > 1 && (!best || dCap / dSave < best.pb)) best = { cfg, res, dCap, dSave, pb: dCap / dSave, dNpv: dSave * f - dCap, k };
      }
      const unit = M.kind === 'micro' ? `${M.name} microinverters` : `${c0.inv ? (c0.inv === 1 ? 'Second ' : 'Third ') : ''}${M.name}`;
      if (best) moves.push({ ...best, kind: 'inv', label: `${unit} with ${best.k} kW of panels` });
    }
    if (!c0.battery && c0.inv > 0 && M.battery) add(`${s.capex.batteryKwh} kWh battery`, 'battery', { ...c0, battery: true });
    if (!moves.length) break;
    // Take the fastest payback among additions that are worth more than they
    // cost at the discount rate.
    const ok = moves.filter(m => m.dNpv > 0 && m.pb <= H).sort((a, b) => a.pb - b.pb);
    if (!ok.length) { rejected.push(...moves.sort((a, b) => a.pb - b.pb).slice(0, 4)); break; }
    const m = ok[0];
    // Merge consecutive +1 kW steps into one line.
    const last = steps[steps.length - 1];
    if (m.kind === 'pv' && last && last.kind === 'pv') {
      last.dCap += m.dCap; last.dSave += m.dSave; last.dNpv += m.dNpv; last.kwAdded += 1; last.cfg = m.cfg; last.res = m.res;
    } else steps.push({ ...m, kwAdded: m.kind === 'pv' ? 1 : m.kind === 'inv' ? m.k : 0 });
    cur = { cfg: m.cfg, res: m.res };
  }
  for (const st of steps) {
    if (st.kind === 'pv') st.label = `+${st.kwAdded} kW of panels`;
    st.pb = st.dCap / st.dSave;
    st.econ = economics(st.res, baseline, s);
  }
  for (const r of rejected) r.econ = economics(r.res, baseline, s);
  return { baseline, steps, rejected, final: cur };
}

// The cheapest array for one setup and inverter, by 25-year cost.
function bestArray(ctx, load, m) {
  const s = ctx.s, M = invOf(s, m), max = Math.floor(maxInv(s, M) * dcPer(s, M) + 1e-9);
  const res0 = evaluate(ctx, { kw: 0, inv: 0, load, m, battery: false });
  let best = { kw: 0, inv: 0, res: res0, cost: lifeCost(res0, res0, s) };
  const seen = new Set();
  const at = kw => {
    if (kw < 1 || kw > max || seen.has(kw)) return;
    seen.add(kw);
    const inv = unitsFor(s, M, kw), res = evaluate(ctx, { kw, inv, load, m, battery: false }), cost = lifeCost(res, res0, s);
    if (cost < best.cost) best = { kw, inv, res, cost };
  };
  // Coarse pass, then every size near the best and at each inverter edge.
  for (let kw = 3; kw <= max; kw += 3) at(kw);
  at(max);
  for (let u = 1; u <= maxInv(s, M); u++) at(Math.floor(u * dcPer(s, M)));
  const k0 = best.kw;
  for (let kw = k0 - 2; kw <= k0 + 2; kw++) at(kw);
  return { ...best, res0 };
}

const pick = r => ({
  cfg: r.cfg, prod: r.prod, imp: r.imp, exp: r.exp, bought: r.bought, paidOut: r.paidOut,
  therms: r.therms, gasService: r.gasService, elecBill: r.elecBill, gasBill: r.gasBill, total: r.total,
  capex: r.capex, solarCapex: r.solarCapex, hpCapex: r.hpCapex, loadKWh: r.loadKWh, econ: r.econ,
  monProd: Array.from(r.monProd), monLoad: Array.from(r.monLoad), monBank: Array.from(r.monBank),
  monBill: Array.from(r.monBill), monGas: Array.from(r.monGas),
});

// Every heat pump setup, heating mode and AHU count, each with its cheapest
// array on inverter m (or on every inverter when m is null). Without gas,
// only heating everything from the heat pumps makes sense.
export const setupLabel = (opt, ahus) => `${HP_OPTIONS[opt].label}, ${ahus === 2 ? 'two AHUs' : 'one AHU'}`;
function compareSetups(ctx, m) {
  const s = ctx.s, rows = [];
  const optIds = s.hp.option in HP_OPTIONS ? [s.hp.option] : Object.keys(HP_OPTIONS);
  const modes = s.hp.heat in HP_MODES ? [s.hp.heat] : Object.keys(HP_MODES);
  const ahuN = [1, 2].includes(Number(s.hp.ahus)) ? [Number(s.hp.ahus)] : [1, 2];
  const invIds = m ? [m] : Object.keys(s.inverters);
  for (const opt of Object.keys(HP_OPTIONS)) for (const mode of Object.keys(HP_MODES)) for (const ahus of [1, 2]) {
    if (s.backup === 'strips' && mode === 'smart') continue;
    const load = `${opt}.${mode}.${ahus}`;
    let best = null;
    for (const id of invIds) { const b = bestArray(ctx, load, id); if (!best || b.cost < best.cost) best = { ...b, m: id }; }
    rows.push({ opt, mode, ahus, load, allowed: optIds.includes(opt) && modes.includes(mode) && ahuN.includes(ahus), ...best });
  }
  return rows;
}

// Everything the solar page shows, as plain data.
export function solarPlan(wxRaw, s = SOLAR_INPUTS, thermalInputs = THERMAL, prepared = prepareWeather(wxRaw)) {
  const th = thermalLoads(wxRaw, thermalInputs, s, prepared);
  const ctx = buildContext(wxRaw, s, thermalInputs, prepared, th);
  const autoInv = !(s.pv.inverter in s.inverters);

  // 1. Which heat pump setup, each with its cheapest array and inverter.
  const setups = compareSetups(ctx, autoInv ? null : s.pv.inverter);
  const win = setups.filter(r => r.allowed).sort((a, b) => a.cost - b.cost)[0];
  const load = win.load;
  ctx.m = win.m;
  const M = invOf(s, ctx.m), dcMax = dcPer(s, M), nMax = maxInv(s, M);
  const today = evaluate(ctx, { kw: 0, inv: 0, load: 'today', battery: false });
  const L0 = loadsFor(ctx, 'today');
  const setupRows = [];
  for (const opt of Object.keys(HP_OPTIONS)) for (const ahus of [1, 2]) {
    const mine = setups.filter(r => r.opt === opt && r.ahus === ahus).sort((a, b) => a.cost - b.cost);
    const best = mine.find(r => r.allowed) ?? mine[0], Lb = loadsFor(ctx, best.load);
    setupRows.push({
      id: `${opt}.${ahus}`, opt, ahus, label: setupLabel(opt, ahus), tons: Lb.tons, mode: best.mode, hpCost: Lb.cost, allowed: best.allowed,
      kw: best.kw, inv: best.inv, m: best.m, invName: s.inverters[best.m].name,
      capex: best.res.capex, bills: best.res.total, billsNoPv: best.res0.total, cost: best.cost,
      modes: Object.fromEntries(mine.map(r => [r.mode, r.cost])),
      hpShare: best.res.hpShare, coolUnmetHrs: Lb.coolUnmetHrs, coolUnmet: Lb.coolUnmet / Math.max(1, Lb.coolTot),
      therms: best.res.therms, unmet: Lb.unmet,
    });
  }
  setupRows.sort((a, b) => (b.allowed - a.allowed) || (a.cost - b.cost));
  // Reference: no heat pump (Phase 1: Navien + Modine, no cooling), with its
  // own cheapest array.
  let noHp = null;
  for (const id of autoInv ? Object.keys(s.inverters) : [s.pv.inverter]) { const b = bestArray(ctx, 'today', id); if (!noHp || b.cost < noHp.cost) noHp = { ...b, m: id }; }
  noHp = { kw: noHp.kw, inv: noHp.inv, invName: s.inverters[noHp.m].name, capex: noHp.res.capex, bills: noHp.res.total, cost: noHp.cost, therms: noHp.res.therms };

  // 2. The solar purchase order on the winning setup.
  const withE = (r, b) => ({ ...r, econ: economics(r, b, s) });
  const Lr = ladder(ctx, load), base = Lr.baseline, rec = Lr.final.res;

  // 3. Every inverter on the same footing, on the winning setup.
  const pvSum = ctx.pvDC.reduce((a, b) => a + b, 0);
  const inverters = Object.entries(s.inverters).map(([id, Mi]) => {
    const cm = { ...ctx, m: id }, Lm = ladder(cm, load), r = withE(Lm.final.res, Lm.baseline);
    const clipped = r.cfg.kw > 0 ? 1 - r.prod / (r.cfg.kw * pvSum * Mi.eff) : 0;
    return {
      id, name: Mi.name, kind: Mi.kind, ac: Mi.ac ?? null, dc: Mi.dc ?? null, eff: Mi.eff, idleW: Mi.idleW, battery: Mi.battery,
      maxUnits: maxInv(s, Mi), cfg: r.cfg, capex: r.solarCapex, invCapex: invCost(Mi, r.cfg), save1: r.econ.save1,
      payback: r.econ.payback, npv: r.econ.npv, total: r.total, clipped,
    };
  }).sort((a, b) => b.npv - a.npv);

  // 4. 25-year cost of each setup by array size, on the chosen inverter.
  // One line per heat pump choice, with its better AHU count and mode.
  const lines = Object.keys(HP_OPTIONS).map(opt => setupRows.filter(r => r.opt === opt).sort((a, b) => a.cost - b.cost)[0]);
  const curve = [];
  const res0 = Object.fromEntries(lines.map(r => [r.opt, evaluate(ctx, { kw: 0, inv: 0, load: `${r.opt}.${r.mode}.${r.ahus}`, battery: false })]));
  for (let kw = 0; kw <= nMax * dcMax; kw++) {
    const row = { kw };
    for (const r of lines) {
      const res = evaluate(ctx, { kw, inv: unitsFor(s, M, kw), load: `${r.opt}.${r.mode}.${r.ahus}`, battery: false });
      row[r.opt] = lifeCost(res, res0[r.opt], s);
    }
    curve.push(row);
  }

  // 5. What would change the answer: the same comparison under other
  // net-metering and gas choices, on the chosen inverter.
  const variants = [];
  const variant = (label, mut) => {
    const s2 = JSON.parse(JSON.stringify(s)); mut(s2);
    const c2 = buildContext(wxRaw, s2, thermalInputs, prepared, th);
    c2.m = ctx.m;
    const rows = compareSetups(c2, ctx.m).filter(r => r.allowed);
    const per = {};
    for (const r of rows) if (!per[r.opt] || r.cost < per[r.opt].cost) per[r.opt] = { cost: r.cost, mode: r.mode, ahus: r.ahus, kw: r.kw, inv: r.inv, unmet: loadsFor(c2, r.load).unmet };
    const winner = Object.entries(per).sort((a, b) => a[1].cost - b[1].cost)[0][0];
    variants.push({ label, per, winner });
  };
  variant('As entered', () => {});
  variant('Gas service dropped, AHU strips as backup', x => { x.backup = 'strips'; x.hp.heat = 'hp'; });
  variant('Annual true-up in April instead', x => { x.rates.trueUpMonth = 3; });
  variant('April true-up and gas dropped', x => { x.rates.trueUpMonth = 3; x.backup = 'strips'; x.hp.heat = 'hp'; });
  variant('Household use 65 kWh/day', x => { x.domestic.kWhPerDay = 65; });
  variant('Gas at $0.80/therm', x => { x.rates.gas = Math.max(x.rates.gas, 0.80); });

  const addBatt = evaluate(ctx, { ...Lr.final.cfg, battery: true });
  const mon = Array(12).fill(0); ctx.pvDC.forEach((v, i) => { mon[ctx.month[i]] += v * M.eff; });
  const Lw = loadsFor(ctx, load);
  return {
    inputs: s,
    setup: { opt: win.opt, mode: win.mode, ahus: win.ahus, label: setupLabel(win.opt, win.ahus), hpLabel: HP_OPTIONS[win.opt].label, tons: Lw.tons, hpCost: Lw.cost, hpShare: rec.hpShare, coolUnmetHrs: Lw.coolUnmetHrs, floorLoss: Lw.floorLoss, floorShare: Lw.floorShare, auto: !(s.hp.option in HP_OPTIONS) },
    lines: lines.map(r => ({ opt: r.opt, ahus: r.ahus, mode: r.mode, label: r.label })),
    setups: setupRows, noHp,
    inverter: { id: ctx.m, ...M, dcMax, maxUnits: nMax, auto: autoInv },
    inverters,
    pvYield: mon.reduce((a, b) => a + b, 0), pvMonthly: mon,
    coolDemand: { btu: L0.coolTot, hours: L0.coolUnmetHrs },
    today: pick(withE(today, today)),
    baseline: pick(withE(base, base)),
    steps: Lr.steps.map(st => ({ label: st.label, kind: st.kind, dCap: st.dCap, dSave: st.dSave, pb: st.pb, dNpv: st.dNpv, cfg: st.cfg, sys: pick(withE(st.res, base)) })),
    rejected: Lr.rejected.map(st => ({ label: st.label, kind: st.kind, dCap: st.dCap, dSave: st.dSave, pb: st.pb, dNpv: st.dNpv })),
    battery: { dCap: addBatt.capex - rec.capex, dSave: rec.total - addBatt.total, possible: !!M.battery },
    recommended: pick(withE(rec, base)),
    lifeCost: lifeCost(rec, base, s),
    curve, variants,
  };
}
