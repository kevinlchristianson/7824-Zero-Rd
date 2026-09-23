// Off-grid questions for 7824 Zero Rd, hour by hour on the Casper TMY3 year,
// on the solar model's loads (thermal model, household electricity, hot
// water) and heat pump curves.
//
//   A  Outage kit for the grid-tied plan: the 21 kW array on hybrid
//      inverters, batteries and a gas generator carry the house through the
//      worst week of the year with no grid. The Navien and the Modine heat
//      as usual (the heat pump heats only on surplus sun). Sized: batteries,
//      generator, and the gas to store for the week.
//   B  Full off grid, no gas: panels, batteries, and the cheapest mix of
//      heat pumps and electric resistance heat. Hot water from the owner's
//      electric tankless, fed buffer-preheated cold water.

import { buildContext, loadsFor, SOLAR_INPUTS } from './solar.js';

export const OFFGRID_INPUTS = {
  inv: 3600, invAC: 12, invDC: 18, idleW: 70, eff: 0.969,   // refurbished EG4 18kPV (owner price)
  batt: 3400, battKwh: 16.1, dod: 0.9, rte: 0.92, battKw: 10, // EG4 indoor WallMount 314Ah (owner price)
  battLife: 15, battReplaceShare: 0.6,                        // assumed: replaced once, at 60% of today's price
  // A: outage kit
  outageKw: 21, outageDays: 7,                                // owner
  gens: [                                                     // assumed installed prices, standby, NG/LP
    { kw: 10, cost: 7000 }, { kw: 14, cost: 8000 }, { kw: 18, cost: 9000 }, { kw: 22, cost: 10000 }, { kw: 26, cost: 11500 },
  ],
  genIdleThPerKw: 0.05, genThPerKwh: 0.089,                   // fuel: therm/h = 0.05·size + 0.089·kW out (Generac 22 kW: 2.08 at half, 3.07 at full)
  propaneTh: 0.915,                                           // therms per gallon of propane
  tanks: [{ gal: 120, cost: 800 }, { gal: 250, cost: 1500 }, { gal: 500, cost: 2500 }, { gal: 1000, cost: 4000 }], // assumed, installed; 80% fill
  // B: full off grid
  resBase: 1500, resPerKw: 100,                               // assumed: electric boiler in the buffer
  resOptions: [0, 10, 20, 30, 45],
  maxBehindH: 6,                                              // B: the house may run behind up to 6 h at a stretch (warm-ups)
  tons: {                                                     // heat pump sets (MBTEK less 20%) with install
    '3.5': { tons: 3.5, cost: 4138 + 1500, label: 'One 3.5-ton' },
    '6': { tons: 6, cost: 5816 + 1500, label: 'One 6-ton' },
    '9.5': { tons: 9.5, cost: 4138 + 5816 + 3000, label: '3.5-ton + 6-ton' },
    '12': { tons: 12, cost: 2 * 5816 + 3000, label: 'Two 6-tons' },
    '18': { tons: 18, cost: 3 * 5816 + 4500, label: 'Three 6-tons' },
    '24': { tons: 24, cost: 4 * 5816 + 6000, label: 'Four 6-tons' },
    '30': { tons: 30, cost: 5 * 5816 + 7500, label: 'Five 6-tons' },
  },
};

const BTU = 3412, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MON_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function offgridContext(wx, s = SOLAR_INPUTS) {
  const ctx = buildContext(wx, s), hp = s.hp, pl = ctx.plant;
  const R0 = hp.reset;
  const tankF = T => clamp(R0.lowF + (R0.lowAtF - T) * (R0.highF - R0.lowF) / (R0.lowAtF - R0.highAtF), R0.lowF, R0.highF);
  const copAt = T => clamp(hp.derate * (T >= 17 ? hp.cop17 + (T - 17) * (hp.cop47 - hp.cop17) / 30 : hp.cop5 + (T - 5) * (hp.cop17 - hp.cop5) / 12), 1, hp.cop47 * 1.3);
  const capAt = T => Math.max(0, hp.cap10 + (T - 10) * (hp.cap47 - hp.cap10) / 37);
  const copF = Tw => Math.max(0.3, 1 - hp.copPerF * (Tw - hp.ratedWaterF)), capF = Tw => Math.max(0.3, 1 - hp.capPerF * (Tw - hp.ratedWaterF));
  const distKW = (pl.fanW + pl.pumpW) / 1000, coolRate = 72000;
  // B loads: heat pumps first, then up to resKw of resistance, and heat still
  // owed is delivered later (warm-ups take longer). Hot water: buffer preheat
  // plus the electric tankless.
  ctx.allElectric = (tons, resKw) => {
    const n = ctx.n, e = new Float64Array(n);
    let debt = 0, run = 0, longest = 0, behindH = 0, resKwh = 0, peak = 0;
    for (let i = 0; i < n; i++) {
      const T = ctx.T[i], Tw = tankF(T), cool = Math.min(ctx.cool[i], coolRate);
      let x = ctx.dom[i] + cool / (4.6 * BTU) + (cool > 0 ? cool / coolRate * distKW : 0);
      const space = ctx.zone.shop[i] + ctx.zone.ground[i] + ctx.zone.upper[i], dhw = ctx.dhw[i];
      x += space / pl.ahuHeatBtuh * distKW;
      const cap = T >= hp.minT ? capAt(T) * tons / 6 * capF(Tw) : 0, cop = Math.max(1, copAt(T) * copF(Tw));
      const pre = cool > 0 ? 0 : dhw * clamp((Math.min(s.dhw.setF, Tw - 10) - ctx.tin[i]) / (s.dhw.setF - ctx.tin[i]), 0, 1);
      const want = space + pre + debt, q = Math.min(want, cap), r = Math.min(want - q, resKw * BTU);
      x += q / (cop * BTU) + r / BTU + (dhw - pre) / BTU;
      resKwh += r / BTU;
      debt = want - q - r;
      if (debt > 1000) { behindH++; run++; longest = Math.max(longest, run); } else run = 0;
      e[i] = x; peak = Math.max(peak, x);
    }
    return { e, behindH, longest, resKwh, peak };
  };
  return ctx;
}

// ---------------------------------------------------------------- A: outage

// The house during an outage: Navien and Modine heat, the heat pump cools
// (and heats only on surplus sun), 21 kW on hybrid inverters.
export function outageLoads(ctx) {
  const P = loadsFor(ctx, 'c35.cool.1'), H = loadsFor(ctx, 'c35.hp.1');
  return { elec: P.elec, gas: P.gas, dE: H.elec.map((v, i) => v - P.elec[i]), dG: P.gas.map((v, i) => v - H.gas[i]) };
}

// One outage of `days` from hour h0 with batteries full. The generator
// starts when the batteries drop below 20%, runs flat out until they're back
// to 90%, or follows the load when there are no batteries.
function outageRun(ctx, L, h0, days, nb, G, O, trace) {
  const kw = O.outageKw, ni = Math.max(2, Math.ceil(kw / O.invDC)), ac = ni * O.invAC;
  const cap = nb * O.battKwh * O.dod, bkw = Math.min(nb * O.battKw, ac), rt = Math.sqrt(O.rte);
  let soc = cap, genOn = false, fuel = 0, genKwh = 0, genH = 0, unserved = 0, heatTh = 0, peak = 0;
  for (let i = h0; i < h0 + days * 24; i++) {
    const p = Math.min(kw * ctx.pvDC[i] * O.eff, ac);
    const load = L.elec[i] + ni * O.idleW / 1000;
    let g = L.gas[i], net = p - load, out = 0;
    peak = Math.max(peak, load);
    if (net >= 0) {
      const ch = Math.min(net, bkw, (cap - soc) / rt); soc += ch * rt; net -= ch;
      if (net > 0 && L.dE[i] > 0 && L.dG[i] > 0) { const f = Math.min(1, net / L.dE[i]); g -= f * L.dG[i]; }
    } else {
      let need = -net;
      if (cap && soc < 0.2 * cap) genOn = true;
      if (genOn || !cap) {
        out = cap ? Math.min(G, need + Math.max(0, (cap - soc) / rt)) : Math.min(G, need);
        const served = Math.min(out, need); soc += Math.min(out - served, bkw) * rt; need -= served;
        fuel += O.genIdleThPerKw * G + O.genThPerKwh * out; genKwh += out; genH++;
        if (cap && soc >= 0.9 * cap) genOn = false;
      }
      const dis = Math.min(need, bkw, soc * rt); soc -= dis / rt; need -= dis;
      if (need > 1e-6) unserved += need;
    }
    heatTh += g;
    if (trace) trace.push({ T: ctx.T[i], pv: p, load, gen: out, soc: cap ? soc / cap : 0, gas: g });
  }
  return { fuel, genKwh, genH, unserved, heatTh, peak };
}

// For each battery count, the smallest generator that holds through every
// week-long outage in the year, and the most gas any of those weeks needs.
export function outageKit(ctx, O = OFFGRID_INPUTS) {
  const L = outageLoads(ctx), days = O.outageDays, rows = [];
  for (const nb of [0, 1, 2, 3, 4, 6, 8]) {
    for (const gen of O.gens) {
      let worst = null, fails = 0;
      for (let d = 0; d + days <= 365; d++) {
        const r = outageRun(ctx, L, d * 24, days, nb, gen.kw, O);
        if (r.unserved > 1) fails++;
        const th = r.fuel + r.heatTh;
        if (!worst || th > worst.th) worst = { ...r, th, day: d };
      }
      if (fails) continue;
      const gal = worst.th / O.propaneTh, tank = O.tanks.find(t => t.gal * 0.8 >= gal) ?? O.tanks.at(-1);
      rows.push({ nb, battKwh: nb * O.battKwh, gen: gen.kw, genCost: gen.cost, ...worst, gal, tank, cost: nb * O.batt + gen.cost + tank.cost });
      break;
    }
  }
  rows.sort((a, b) => a.cost - b.cost);
  // Recommended: the cheapest kit with batteries. Hybrid inverters need a
  // battery to run the panels with the grid down, and it spares the
  // generator from idling along at light load.
  const b = rows.find(r => r.nb >= 2) ?? rows[0], trace = [];
  if (b) outageRun(ctx, L, b.day * 24, days, b.nb, b.gen, O, trace);
  const m = b ? MON_START.findLastIndex(s0 => s0 <= b.day) : 0;
  return { rows, best: b, cheapest: rows[0], trace, start: b ? { month: m, day: b.day - MON_START[m] + 1 } : null };
}

// ---------------------------------------------------------------- B: off grid

export function simulateB(ctx, design, O = OFFGRID_INPUTS, trace = false) {
  const s = ctx.s, f = s.finance, { kw, nb, tons, resKw } = design;
  const L = (ctx._ae ??= {})[`${tons}/${resKw}`] ??= ctx.allElectric(O.tons[tons].tons, resKw);
  const ni = Math.max(2, Math.ceil(kw / O.invDC), Math.ceil(L.peak / O.invAC));
  const ac = ni * O.invAC, cap = nb * O.battKwh * O.dod, bkw = Math.min(nb * O.battKw, ac), rt = Math.sqrt(O.rte);
  let soc = cap, st;
  for (let pass = 0; pass < 2; pass++) {
    st = { unserved: 0, unH: 0, spill: 0, prod: 0, load: 0 };
    const mon = trace ? { prod: Array(12).fill(0), load: Array(12).fill(0), spill: Array(12).fill(0) } : null;
    const daySoc = trace ? Array(365).fill(1) : null;
    for (let i = 0; i < ctx.n; i++) {
      const m = ctx.month[i], p = Math.min(kw * ctx.pvDC[i] * O.eff, ac), load = L.e[i] + ni * O.idleW / 1000;
      const net = p - load;
      if (net >= 0) { const ch = Math.min(net, bkw, (cap - soc) / rt); soc += ch * rt; st.spill += net - ch; if (mon) mon.spill[m] += net - ch; }
      else { let need = -net; const dis = Math.min(need, bkw, soc * rt); soc -= dis / rt; need -= dis; if (need > 1e-6) { st.unserved += need; st.unH++; } }
      st.prod += p; st.load += load;
      if (mon) { mon.prod[m] += p; mon.load[m] += load; }
      if (daySoc) { const d = Math.floor(i / 24); daySoc[d] = Math.min(daySoc[d], cap ? soc / cap : 0); }
    }
    if (trace) { st.mon = mon; st.daySoc = daySoc; }
  }
  const capex = kw * s.capex.pvPerKw + s.capex.fixed + ni * O.inv + nb * O.batt + O.tons[tons].cost + s.hp.buffer + s.hp.controls
    + (resKw ? O.resBase + O.resPerKw * resKw : 0);
  const life = capex + nb * O.batt * O.battReplaceShare / (1 + f.discount) ** O.battLife;
  return { ...design, ni, battKwh: nb * O.battKwh, capex, life, behindH: L.behindH, longestBehind: L.longest, resKwh: L.resKwh, peak: L.peak, ...st };
}

// Cheapest full off-grid design: every heat pump set and resistance size,
// with the smallest panels for each battery bank that never runs short and
// never leaves the house behind longer than maxBehindH.
export function optimizeB(ctx, O = OFFGRID_INPUTS) {
  const kws = Array.from({ length: 36 }, (_, k) => 24 + 6 * k);
  const nbs = [4, 6, 8, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58, 61, 64, 70, 76];
  const rows = [];
  for (const tons of Object.keys(O.tons)) for (const resKw of O.resOptions) {
    const L = (ctx._ae ??= {})[`${tons}/${resKw}`] ??= ctx.allElectric(O.tons[tons].tons, resKw);
    const row = { tons, resKw, label: O.tons[tons].label, longestBehind: L.longest, behindH: L.behindH, resKwh: L.resKwh, design: null };
    rows.push(row);
    if (L.longest > O.maxBehindH) continue;
    for (const nb of nbs) {
      if (simulateB(ctx, { kw: kws.at(-1), nb, tons, resKw }).unserved > 1) continue;
      let lo = 0, hi = kws.length - 1, hit = null;
      while (lo <= hi) { const mid = (lo + hi) >> 1, x = simulateB(ctx, { kw: kws[mid], nb, tons, resKw }); if (x.unserved <= 1) { hit = x; hi = mid - 1; } else lo = mid + 1; }
      if (hit && (!row.design || hit.life < row.design.life)) row.design = hit;
    }
  }
  const ok = rows.filter(r => r.design).sort((a, b) => a.design.life - b.design.life);
  return { rows, best: ok.length ? simulateB(ctx, ok[0].design, O, true) : null };
}
