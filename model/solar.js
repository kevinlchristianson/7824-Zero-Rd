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
  hp: {
    cop47: 3.8, cop17: 2.5, cop5: 1.9, derate: 0.9, minT: -13,   // sheet (Apollo 6T)
    cap47: 72000, cap10: 39200,                                  // sheet, Btu/h
    existingHeats: true,             // assumed: the 3.5-ton Apollo also heats
    existingTons: 3.5,               // owner
    dhwCopFactor: 0.85,              // assumed: hotter water, lower COP
    cost: 9000,                      // assumed: installed cost of the 6-ton unit
  },
  dhw: { galPerDay: 40, setF: 120, eff: 0.90 },  // assumed household hot water
  domestic: { kWhPerDay: 47, indoor: 0.7 },       // sheet
  cool: { cop: 4.6 },                              // owner: Apollo 3.5-ton
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

// Hourly thermal loads from the heating & cooling model, with the upper
// level's internal gains taken from the domestic electricity use.
export function thermalLoads(wxRaw, thermalInputs, s, prepared) {
  const inp = JSON.parse(JSON.stringify(thermalInputs));
  const upperA = 48 * 68;
  const w = s.domestic.kWhPerDay * s.domestic.indoor / 24 * 1000 / upperA;   // W/ft²
  inp.upper.gainsOn = w; inp.upper.gainsOff = w * 0.3;
  const r = runModel(wxRaw, inp, undefined, { prepared });
  const n = r.wx.n, keep = 1 - (inp.plant.distLoss ?? 0);
  const heat = new Float64Array(n), cool = new Float64Array(n);
  for (const z of ['shop', 'ground', 'upper']) {
    const k = ZONES.indexOf(z);
    for (let i = 0; i < n; i++) { heat[i] += r.main.Qh[k][i] / keep; cool[i] += r.main.Qc[k][i] / keep; }
  }
  return { heat, cool, plant: inp.plant, costs: r.cost, wx: r.wx };
}

// Everything that does not depend on the solar array: hourly electric load
// and gas for the two heating choices (boiler today, heat pumps).
export function buildContext(wxRaw, s = SOLAR_INPUTS, thermalInputs = THERMAL, prepared = prepareWeather(wxRaw), th = thermalLoads(wxRaw, thermalInputs, s, prepared)) {
  const wx = prepared, n = wx.n, pl = th.plant;
  const distKW = (pl.fanW + pl.pumpW) / 1000, coolCap = pl.coolTons * 12000;
  const hp = s.hp;
  const hpScale = 1 + (hp.existingHeats ? hp.existingTons / 6 : 0);
  const base = { elec: new Float64Array(n), gas: new Float64Array(n) };     // therms
  const hpc = { elec: new Float64Array(n), gas: new Float64Array(n), backupElec: 0, unmet: 0, hpShare: 0 };
  let heatTot = 0, hpHeat = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.floor(i / 24), h = i % 24, T = wx.T[i];
    const dom = s.domestic.kWhPerDay * DOMESTIC_SHAPE[h];
    // Hot water: inlet water follows the season (≈ 42–58 °F in Casper).
    const tin = 50 + 8 * Math.cos(2 * Math.PI * (d - 240) / 365);
    const dhw = s.dhw.galPerDay * DHW_SHAPE[h] * 8.34 * (s.dhw.setF - tin);          // Btu this hour
    const space = th.heat[i], cool = th.cool[i];
    const coolKWh = cool / (s.cool.cop * BTU_KWH) + cool / coolCap * distKW;
    const heatFan = space / pl.ahuHeatBtuh * distKW;
    base.elec[i] = dom + coolKWh + heatFan;
    base.gas[i] = (space / pl.boilerEff + dhw / s.dhw.eff) / 1e5;

    // Heat pumps first, backup for the rest.
    const cap = T >= hp.minT ? capAt(hp, T) * hpScale : 0;
    const cop = copAt(hp, T);
    const qs = Math.min(space, cap), qd = Math.min(dhw, Math.max(0, cap - qs));
    let e = dom + coolKWh + heatFan + qs / (cop * BTU_KWH) + qd / (cop * hp.dhwCopFactor * BTU_KWH);
    let rem = space - qs + dhw - qd, g = 0;
    if (s.backup === 'strips') {
      const strip = Math.min(rem, 10 * BTU_KWH);
      e += strip / BTU_KWH; hpc.backupElec += strip / BTU_KWH; hpc.unmet += rem - strip;
    } else g = ((space - qs) / pl.boilerEff + (dhw - qd) / s.dhw.eff) / 1e5;
    hpc.elec[i] = e; hpc.gas[i] = g;
    heatTot += space + dhw; hpHeat += qs + qd;
  }
  hpc.hpShare = hpHeat / heatTot;
  const month = wx.month;
  return { n, month, base, hpc, pvDC: pvPerKw(wx, s.pv), s, m: pickInverter(s), heatTot, thermal: th, dhwBtu: 0 };
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

// cfg: { kw (DC), inv (count), hp (bool), battery (bool), m (inverter id) }
export function evaluate(ctx, cfg) {
  const s = ctx.s, r = s.rates, c = s.capex, n = ctx.n;
  const L = cfg.hp ? ctx.hpc : ctx.base;
  const M = invOf(s, cfg.m ?? ctx.m);
  const ac = acOf(M, cfg), eff = M.eff, idle = cfg.kw > 0 ? cfg.inv * M.idleW / 1000 : 0;
  const monImp = new Float64Array(12), monExp = new Float64Array(12), monProd = new Float64Array(12), monLoad = new Float64Array(12);
  let soc = 0, prod = 0, direct = 0;
  const bCap = cfg.battery ? c.batteryKwh : 0;
  for (let i = 0; i < n; i++) {
    const p = Math.min(cfg.kw * ctx.pvDC[i] * eff, ac), load = L.elec[i] + idle, m = ctx.month[i];
    prod += p; monProd[m] += p; monLoad[m] += load;
    let net = load - p;
    direct += Math.min(p, load);
    if (bCap) {
      if (net < 0) { const ch = Math.min(-net, c.batteryKw, (bCap - soc) / Math.sqrt(c.batteryRte)); soc += ch * Math.sqrt(c.batteryRte); net += ch; }
      else if (net > 0) { const dis = Math.min(net, c.batteryKw, soc * Math.sqrt(c.batteryRte)); soc -= dis / Math.sqrt(c.batteryRte); net -= dis; }
    }
    if (net > 0) monImp[m] += net; else monExp[m] -= net;
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
  const gasService = therms > 0.5 || s.backup !== 'strips' || !cfg.hp;
  const gasBill = therms * r.gas + (gasService ? 12 * r.gasFixed : 0);
  const capex = (cfg.kw > 0 ? cfg.kw * c.pvPerKw + c.fixed : 0) + invCost(M, cfg)
    + (cfg.hp ? s.hp.cost : 0) + (cfg.battery ? c.batteryKwh * c.batteryPerKwh : 0);
  return {
    cfg, prod, direct, imp: sumA(monImp), exp: sumA(monExp), bought, paidOut, therms, gasService,
    elecBill, gasBill, total: elecBill + gasBill, capex: capex * (1 - c.incentive),
    monProd, monLoad, monImp, monExp, monBill, monBank, monGas,
    loadKWh: sumA(monLoad),
  };
}
const sumA = a => a.reduce((x, y) => x + y, 0);

// Payback and long-run value of a result against a baseline result.
export function economics(res, baseline, s) {
  const f = s.finance, r = s.rates;
  const save1 = baseline.total - res.total;
  const g = r.escalation - (res.cfg.kw > 0 ? r.degradation : 0);
  let cum = 0, payback = null, gain = -res.capex, npv = -res.capex;
  for (let y = 1; y <= f.horizon; y++) {
    const sy = save1 * (1 + g) ** (y - 1);
    gain += sy;
    npv += sy / (1 + f.discount) ** y;
    if (payback == null && cum + sy >= res.capex) payback = y - 1 + (res.capex - cum) / sy;
    cum += sy;
  }
  const i = f.loanRate / 12, nPay = f.loanYears * 12;
  const loanYear = res.capex > 0 ? 12 * res.capex * i / (1 - (1 + i) ** -nPay) : 0;
  return { save1, payback: res.capex > 0 && save1 > 0 ? payback : null, simple: save1 > 0 ? res.capex / save1 : null, gain, npv, loanYear, cash1: save1 - loanYear };
}

// ---------------------------------------------------------------- plans

// Every combination on a grid, for the size curves and the best-of picks.
export function grid(ctx) {
  const s = ctx.s, M = invOf(s, ctx.m), baseline = evaluate(ctx, { kw: 0, inv: 0, hp: false, battery: false });
  const rows = [];
  for (const hp of [false, true]) for (const battery of [false, true]) for (let inv = 1; inv <= maxInv(s, M); inv++) {
    for (let kw = 0; kw <= inv * dcPer(s, M) + 1e-9; kw += 1) {
      if (kw === 0 && (inv > 1 || battery)) continue;
      const cfg = { kw, inv: kw === 0 ? 0 : inv, hp, battery };
      const res = evaluate(ctx, cfg);
      rows.push({ ...res, econ: economics(res, baseline, s) });
    }
  }
  return { baseline, rows };
}

// A purchase order: from today's setup, repeatedly take the addition with
// the shortest payback on its own extra cost, until nothing left pays back
// within the horizon.
export function ladder(ctx) {
  const s = ctx.s, H = s.finance.horizon, M = invOf(s, ctx.m), dcMax = dcPer(s, M), nMax = maxInv(s, M);
  const baseline = evaluate(ctx, { kw: 0, inv: 0, hp: false, battery: false });
  let cur = { cfg: { kw: 0, inv: 0, hp: false, battery: false }, res: baseline };
  const steps = [], rejected = [];
  const tryCfg = cfg => evaluate(ctx, cfg);
  for (let guard = 0; guard < 60; guard++) {
    const moves = [];
    const c0 = cur.cfg;
    const f = s.finance, g = s.rates.escalation - s.rates.degradation;
    // Present value of $1/yr of savings growing with rates, over the horizon.
    const pvf = Array.from({ length: f.horizon }, (_, y) => (1 + g) ** y / (1 + f.discount) ** (y + 1)).reduce((a, b) => a + b, 0);
    const add = (label, kind, cfg, extra = {}) => {
      const res = tryCfg(cfg);
      const dCap = res.capex - cur.res.capex, dSave = cur.res.total - res.total;
      if (dSave > 1 && dCap > 0) moves.push({ label, kind, cfg, res, dCap, dSave, pb: dCap / dSave, dNpv: dSave * pvf - dCap, ...extra });
    };
    // Panels: in 1 kW steps on existing inverters, or a new inverter with
    // the best fill of panels.
    if (c0.inv > 0 && c0.kw + 1 <= c0.inv * dcMax + 1e-9) add('+1 kW of panels', 'pv', { ...c0, kw: c0.kw + 1 });
    if (c0.inv < nMax) {
      for (const withHp of c0.hp ? [false] : [false, true]) {
        let best = null;
        for (let k = 2; k <= dcMax; k++) {
          const cfg = { ...c0, inv: c0.inv + 1, kw: c0.kw + k, hp: c0.hp || withHp };
          const res = tryCfg(cfg), dCap = res.capex - cur.res.capex, dSave = cur.res.total - res.total;
          if (dSave > 1 && (!best || dCap / dSave < best.pb)) best = { cfg, res, dCap, dSave, pb: dCap / dSave, dNpv: dSave * pvf - dCap, k };
        }
        const unit = M.kind === 'micro' ? `${M.name} microinverters` : `${c0.inv ? (c0.inv === 1 ? 'second ' : 'third ') : ''}${M.name}`;
        const lab = `${withHp ? 'Heat pump + ' : ''}${unit} with ${best?.k} kW of panels`;
        if (best) moves.push({ ...best, kind: withHp ? 'hp' : 'inv', label: lab[0].toUpperCase() + lab.slice(1) });
      }
    }
    if (!c0.hp) {
      add('Heat pump for heating', 'hp', { ...c0, hp: true });
      if (c0.inv > 0) for (let k = 1; k <= 12 && c0.kw + k <= c0.inv * dcMax; k++) add(`Heat pump + ${k} kW of panels`, 'hp', { ...c0, hp: true, kw: c0.kw + k });
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
      last.dCap += m.dCap; last.dSave += m.dSave; last.dNpv += m.dNpv; last.kwAdded += 1; last.pbMax = m.pb; last.cfg = m.cfg; last.res = m.res;
    } else steps.push({ ...m, kwAdded: m.kind === 'pv' ? 1 : m.kind === 'inv' ? m.k : 0, pbMax: m.pb });
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

// ---------------------------------------------------------------- page

const pick = r => ({
  cfg: r.cfg, prod: r.prod, imp: r.imp, exp: r.exp, bought: r.bought, paidOut: r.paidOut,
  therms: r.therms, gasService: r.gasService, elecBill: r.elecBill, gasBill: r.gasBill, total: r.total,
  capex: r.capex, loadKWh: r.loadKWh, econ: r.econ,
  monProd: Array.from(r.monProd), monLoad: Array.from(r.monLoad), monBank: Array.from(r.monBank),
  monBill: Array.from(r.monBill), monGas: Array.from(r.monGas),
});

// Everything the solar page shows, as plain data.
export function solarPlan(wxRaw, s = SOLAR_INPUTS, thermalInputs = THERMAL, prepared = prepareWeather(wxRaw)) {
  const th = thermalLoads(wxRaw, thermalInputs, s, prepared);
  const ctx = buildContext(wxRaw, s, thermalInputs, prepared, th);
  const baseline = evaluate(ctx, { kw: 0, inv: 0, hp: false, battery: false });
  const withE = r => ({ ...r, econ: economics(r, baseline, s) });

  // Every inverter on the same footing: its own purchase order, and the
  // best system it allows with the new heat pump.
  const inverters = Object.entries(s.inverters).map(([id, M]) => {
    const cm = { ...ctx, m: id }, Lm = ladder(cm), r = withE(Lm.final.res);
    let hpBest = null;
    for (let inv = 1; inv <= maxInv(s, M); inv++) for (let kw = 2; kw <= inv * dcPer(s, M); kw++) {
      const e = economics(evaluate(cm, { kw, inv, hp: true, battery: false }), baseline, s);
      if (!hpBest || e.npv > hpBest.npv) hpBest = { kw, inv, npv: e.npv };
    }
    const clipped = r.cfg.kw > 0 ? 1 - r.prod / (r.cfg.kw * ctx.pvDC.reduce((a, b) => a + b, 0) * M.eff) : 0;
    return {
      id, name: M.name, kind: M.kind, ac: M.ac ?? null, dc: M.dc ?? null, eff: M.eff, idleW: M.idleW, battery: M.battery,
      maxUnits: maxInv(s, M), cfg: r.cfg, capex: r.capex, invCapex: invCost(M, r.cfg), save1: r.econ.save1,
      payback: r.econ.payback, npv: r.econ.npv, total: r.total, clipped, hpBest,
    };
  }).sort((a, b) => b.npv - a.npv);
  const chosen = s.pv.inverter in s.inverters ? s.pv.inverter : inverters[0].id;
  ctx.m = chosen;
  const M = invOf(s, chosen), dcMax = dcPer(s, M), nMax = maxInv(s, M);
  const L = ladder(ctx);
  const rec = L.final.res;

  // Value of each array size, with and without the heat pump (no battery),
  // using the cheapest inverter count that fits the panels.
  const curve = [];
  for (let kw = 0; kw <= nMax * dcMax; kw++) {
    const inv = kw === 0 ? 0 : Math.ceil(kw / dcMax);
    const row = { kw };
    for (const hp of [false, true]) {
      const r = withE(evaluate(ctx, { kw, inv, hp, battery: false }));
      row[hp ? 'hp' : 'nohp'] = { npv: r.econ.npv, payback: r.econ.payback, total: r.total, capex: r.capex };
    }
    curve.push(row);
  }

  // The recommended system with a battery added, and the heat pump added.
  const cfgR = L.final.cfg;
  const addBatt = withE(evaluate(ctx, { ...cfgR, battery: true }));
  const bestHp = curve.reduce((b, r) => (!b || r.hp.npv > b.hp.npv ? r : b), null);

  // What it would take for the heat pump to pay: the same questions under
  // other net-metering and gas choices.
  const variants = [];
  const variant = (label, mut) => {
    const s2 = JSON.parse(JSON.stringify(s)); mut(s2);
    const c2 = buildContext(wxRaw, s2, thermalInputs, prepared, th);
    c2.m = chosen;
    const b2 = evaluate(c2, { kw: 0, inv: 0, hp: false, battery: false });
    let best = { npv: -Infinity }, bestNo = { npv: -Infinity };
    for (let inv = 1; inv <= nMax; inv++) for (let kw = 2; kw <= inv * dcMax; kw++) {
      for (const hp of [false, true]) {
        const r = evaluate(c2, { kw, inv, hp, battery: false }), e = economics(r, b2, s2);
        const o = { kw, inv, npv: e.npv, payback: e.payback, total: r.total };
        if (hp && e.npv > best.npv) best = o;
        if (!hp && e.npv > bestNo.npv) bestNo = o;
      }
    }
    variants.push({ label, hp: best, nohp: bestNo, gain: best.npv - bestNo.npv, unmet: c2.hpc.unmet });
  };
  variant('As entered', () => {});
  variant('Gas service dropped, AHU strips as backup', x => { x.backup = 'strips'; });
  variant('Annual true-up in April instead', x => { x.rates.trueUpMonth = 3; });
  variant('April true-up and gas dropped', x => { x.rates.trueUpMonth = 3; x.backup = 'strips'; });
  variant('Gas at $0.80/therm', x => { x.rates.gas = Math.max(x.rates.gas, 0.80); });

  const mon = Array(12).fill(0); ctx.pvDC.forEach((v, i) => { mon[ctx.month[i]] += v * M.eff; });
  return {
    inputs: s,
    inverter: { id: chosen, ...M, dcMax, maxUnits: nMax, auto: !(s.pv.inverter in s.inverters) },
    inverters,
    pvYield: mon.reduce((a, b) => a + b, 0), pvMonthly: mon,
    hpShare: ctx.hpc.hpShare,
    baseline: pick(withE(baseline)),
    hpNoPv: pick(withE(evaluate(ctx, { kw: 0, inv: 0, hp: true, battery: false }))),
    steps: L.steps.map(st => ({ label: st.label, kind: st.kind, dCap: st.dCap, dSave: st.dSave, pb: st.pb, dNpv: st.dNpv, cfg: st.cfg, sys: pick(withE(st.res)) })),
    rejected: L.rejected.map(st => ({ label: st.label, kind: st.kind, dCap: st.dCap, dSave: st.dSave, pb: st.pb, dNpv: st.dNpv })),
    battery: { dCap: addBatt.capex - rec.capex, dSave: rec.total - addBatt.total },
    recommended: pick(withE(rec)),
    bestHp: { kw: bestHp.kw, ...bestHp.hp },
    curve, variants,
    heatingCosts: { thermalTotal: th.costs.totals.total },
  };
}
