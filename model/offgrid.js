// Off-grid questions for 7824 Zero Rd, hour by hour on the Casper TMY3 year,
// on the solar model's loads (thermal model, household electricity, hot
// water) and heat pump curves.
//
//   A  Outage kit for the grid-tied plan: the shop-roof array on hybrid
//      inverters, batteries and a gas generator carry the house through the
//      worst week of the year with no grid. The Navien and the Modine heat
//      as usual (the heat pump heats only on surplus sun). Sized: batteries,
//      generator, and the gas to store for the week.
//   B  Full off grid, no gas: panels, batteries, and the cheapest mix of
//      heat pumps and electric resistance heat. Hot water from the owner's
//      electric tankless, fed buffer-preheated cold water.
//   C  B with an outdoor wood boiler feeding the buffer: it covers whatever
//      the heat pumps can't, and takes over the heat when the batteries run
//      low or it's cold enough, so the batteries carry only the house.
//   B and C live normally and drop into conservation mode (see
//   conservation()) only when the batteries run low, for at most maxConsH
//   hours a year: the worst weeks and cold snaps. Set ctx.cons to the
//   conservation context to enable it.

import { buildContext, loadsFor, SOLAR_INPUTS } from './solar.js';
import { INPUTS as THERMAL } from './thermal.js';

// Grid-down conservation mode (owner): the shop unheated, downstairs held
// at its minimum with no warm-ups, upstairs at 65 °F, household lights and
// plug loads cut 60%. Cooling, if an outage lands in summer, rises to 78 °F
// (assumed).
export function conservation(s = SOLAR_INPUTS, t = THERMAL) {
  const s2 = JSON.parse(JSON.stringify(s)), t2 = JSON.parse(JSON.stringify(t));
  s2.domestic.kWhPerDay = s.domestic.kWhPerDay * 0.4;
  t2.shop.hoursPerWeek = 0; t2.shop.minF = -60; t2.shop.occF = -60;   // unheated: floats
  t2.ground.hoursPerWeek = 0; t2.ground.occF = t2.ground.minF;
  t2.upper.heatF = 65; t2.upper.unoccDays = 0; t2.upper.coolF = 78;
  return { s: s2, t: t2 };
}

export const OFFGRID_INPUTS = {
  inv: 3600, invAC: 12, invDC: 18, idleW: 70, eff: 0.969,   // refurbished EG4 18kPV (owner price)
  batt: 3400, battKwh: 16.1, dod: 0.9, rte: 0.92, battKw: 10, // EG4 indoor WallMount 314Ah (owner price)
  battLife: 15, battReplaceShare: 0.6,                        // assumed: replaced once, at 60% of today's price
  // A: outage kit
  outageKw: 31.68, outageDays: 7,                             // owner: the shop-roof array (72 x 440 W on two 18kPVs)
  gens: [                                                     // assumed installed prices, standby, NG/LP
    { kw: 10, cost: 7000 }, { kw: 14, cost: 8000 }, { kw: 18, cost: 9000 }, { kw: 22, cost: 10000 }, { kw: 26, cost: 11500 },
  ],
  genIdleThPerKw: 0.05, genThPerKwh: 0.089,                   // fuel: therm/h = 0.05·size + 0.089·kW out (Generac 22 kW: 2.08 at half, 3.07 at full)
  propaneTh: 0.915,                                           // therms per gallon of propane
  tanks: [{ gal: 120, cost: 800 }, { gal: 250, cost: 1500 }, { gal: 500, cost: 2500 }, { gal: 1000, cost: 4000 }], // assumed, installed; 80% fill
  // B: full off grid
  resBase: 1500, resPerKw: 100,                               // assumed: electric boiler in the buffer
  resOptions: [0, 10, 20, 30, 45],
  tankResKw: 0,                                               // resistance built into the buffer itself (an electric water heater as the buffer); costs nothing extra
  maxBehindH: 6,                                              // B: the house may run behind up to 6 h at a stretch (warm-ups)
  maxConsH: 336,                                              // owner: conservation only in the worst stretches, at most two weeks a year
  consRules: [null, { on: 0.15, off: 0.5 }, { on: 0.3, off: 0.6 }, { on: 0.5, off: 0.8 }],  // enter below `on`, leave at `off` battery charge
  // C: outdoor wood boiler (assumed: Central Boiler-class unit, 150k Btu/h)
  owb: 18000, owbBtuh: 150000, owbEff: 0.65, owbPumpKw: 0.15, // installed with buried lines and a buffer exchanger; efficiency at full burn
  owbIdleBtuh: 20000,                                         // assumed: wood burned while the fire idles, held back below full output
  bufferGal: 250, bufferMaxF: 180, bufferStore: true,         // owner: with the fire lit, the buffer runs at max; the floor keeps its mixing valve
  cordMMBtu: 16, cordCost: 250,                               // Wyoming mixed wood per cord; delivered price
  woodPolicies: [                                             // burn when batteries fall below socOn (until socOff), or below tF
    { socOn: 0.2, socOff: 0.5, tF: null }, { socOn: 0.4, socOff: 0.7, tF: null }, { socOn: 0.6, socOff: 0.9, tF: null },
    { socOn: 0.3, socOff: 0.6, tF: 10 }, { socOn: 0.3, socOff: 0.6, tF: 25 }, { socOn: 0.3, socOff: 0.6, tF: 40 },
    { socOn: 1.01, socOff: 1.01, tF: null },                  // always, whenever there's heat to make
  ],
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

// Resistance beyond what the tank has built in comes from an inline electric
// boiler on the buffer.
const resCost = (kw, O) => (kw > (O.tankResKw ?? 0) ? O.resBase + O.resPerKw * (kw - (O.tankResKw ?? 0)) : 0);
const BTU = 3412, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MON_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function offgridContext(wx, s = SOLAR_INPUTS, thermalInputs = THERMAL) {
  const ctx = buildContext(wx, s, thermalInputs), hp = s.hp, pl = ctx.plant;
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
      const pre = cool > 0 ? 0 : dhw * clamp((Math.min(s.dhw.setF, Tw - hp.preheatApproachF) - ctx.tin[i]) / (s.dhw.setF - ctx.tin[i]), 0, 1);
      const want = space + pre + debt, q = Math.min(want, cap), r = Math.min(want - q, resKw * BTU);
      x += q / (cop * BTU) + r / BTU + (dhw - pre) / BTU;
      resKwh += r / BTU;
      debt = want - q - r;
      if (debt > 1000) { behindH++; run++; longest = Math.max(longest, run); } else run = 0;
      e[i] = x; peak = Math.max(peak, x);
    }
    return { e, behindH, longest, resKwh, peak };
  };
  // C parts: the house's own electricity, the heat the buffer must supply,
  // and what the heat pumps can do toward it each hour.
  ctx.woodParts = tons => {
    const n = ctx.n, base = new Float64Array(n), space = new Float64Array(n), tw = new Float64Array(n), cap = new Float64Array(n), cop = new Float64Array(n), chilled = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const T = ctx.T[i], Tw = tankF(T), cool = Math.min(ctx.cool[i], coolRate);
      const sp = ctx.zone.shop[i] + ctx.zone.ground[i] + ctx.zone.upper[i];
      base[i] = ctx.dom[i] + cool / (4.6 * BTU) + (cool > 0 ? cool / coolRate * distKW : 0) + sp / pl.ahuHeatBtuh * distKW;
      space[i] = sp; tw[i] = Tw; chilled[i] = cool > 0 ? 1 : 0;
      cap[i] = T >= hp.minT ? capAt(T) * tons / 6 * capF(Tw) : 0; cop[i] = Math.max(1, copAt(T) * copF(Tw));
    }
    return { base, space, tw, cap, cop, chilled, dhw: ctx.dhw, tin: ctx.tin, setF: s.dhw.setF, approach: hp.preheatApproachF };
  };
  return ctx;
}

// ---------------------------------------------------------------- A: outage

// The house during an outage: Navien and Modine heat, the heat pump cools
// (and heats only on surplus sun), the shop-roof array on hybrid inverters.
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
  const rule = design.cons, Lc = rule && ctx.cons ? ((ctx.cons._ae ??= {})[`${tons}/${resKw}`] ??= ctx.cons.allElectric(O.tons[tons].tons, resKw)) : null;
  const ni = Math.max(2, Math.ceil(kw / O.invDC), Math.ceil(L.peak / O.invAC));
  const ac = ni * O.invAC, cap = nb * O.battKwh * O.dod, bkw = Math.min(nb * O.battKw, ac), rt = Math.sqrt(O.rte);
  let soc = cap, st;
  for (let pass = 0; pass < 2; pass++) {
    st = { unserved: 0, unH: 0, spill: 0, prod: 0, load: 0, consH: 0 };
    const mon = trace ? { prod: Array(12).fill(0), load: Array(12).fill(0), spill: Array(12).fill(0) } : null;
    const daySoc = trace ? Array(365).fill(1) : null, dayCons = trace ? Array(365).fill(0) : null;
    let conserving = false;
    for (let i = 0; i < ctx.n; i++) {
      if (Lc) { const fr = cap ? soc / cap : 0; if (fr < rule.on) conserving = true; else if (fr >= rule.off) conserving = false; }
      if (conserving) { st.consH++; if (dayCons) dayCons[Math.floor(i / 24)] = 1; }
      const m = ctx.month[i], p = Math.min(kw * ctx.pvDC[i] * O.eff, ac), load = (conserving ? Lc.e[i] : L.e[i]) + ni * O.idleW / 1000;
      const net = p - load;
      if (net >= 0) { const ch = Math.min(net, bkw, (cap - soc) / rt); soc += ch * rt; st.spill += net - ch; if (mon) mon.spill[m] += net - ch; }
      else { let need = -net; const dis = Math.min(need, bkw, soc * rt); soc -= dis / rt; need -= dis; if (need > 1e-6) { st.unserved += need; st.unH++; } }
      st.prod += p; st.load += load;
      if (mon) { mon.prod[m] += p; mon.load[m] += load; }
      if (daySoc) { const d = Math.floor(i / 24); daySoc[d] = Math.min(daySoc[d], cap ? soc / cap : 0); }
    }
    if (trace) { st.mon = mon; st.daySoc = daySoc; st.dayCons = dayCons; }
  }
  const capex = kw * s.capex.pvPerKw + s.capex.fixed + ni * O.inv + nb * O.batt + O.tons[tons].cost + s.hp.buffer + s.hp.controls
    + resCost(resKw, O);
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
  const holds = x => x.unserved <= 1 && x.consH <= O.maxConsH;
  for (const tons of Object.keys(O.tons)) for (const resKw of O.resOptions) {
    const L = (ctx._ae ??= {})[`${tons}/${resKw}`] ??= ctx.allElectric(O.tons[tons].tons, resKw);
    const row = { tons, resKw, label: O.tons[tons].label, longestBehind: L.longest, behindH: L.behindH, resKwh: L.resKwh, design: null };
    rows.push(row);
    if (L.longest > O.maxBehindH) continue;
    for (const cons of ctx.cons ? O.consRules : [null]) for (const nb of nbs) {
      if (!holds(simulateB(ctx, { kw: kws.at(-1), nb, tons, resKw, cons }, O))) continue;
      let lo = 0, hi = kws.length - 1, hit = null;
      while (lo <= hi) { const mid = (lo + hi) >> 1, x = simulateB(ctx, { kw: kws[mid], nb, tons, resKw, cons }, O); if (holds(x)) { hit = x; hi = mid - 1; } else lo = mid + 1; }
      if (hit && (!row.design || hit.life < row.design.life)) row.design = hit;
    }
  }
  const ok = rows.filter(r => r.design).sort((a, b) => a.design.life - b.design.life);
  return { rows, best: ok.length ? simulateB(ctx, ok[0].design, O, true) : null };
}

// ---------------------------------------------------------------- C: wood

export function simulateC(ctx, design, O = OFFGRID_INPUTS, trace = false) {
  const s = ctx.s, f = s.finance, r = s.rates, { kw, nb, tons, policy } = design;
  const W = (ctx._wp ??= {})[tons] ??= ctx.woodParts(O.tons[tons].tons);
  const rule = design.cons, Wc = rule && ctx.cons ? ((ctx.cons._wp ??= {})[tons] ??= ctx.cons.woodParts(O.tons[tons].tons)) : null;
  const ni = Math.max(2, Math.ceil(kw / O.invDC)), ac = ni * O.invAC, cap = nb * O.battKwh * O.dod, bkw = Math.min(nb * O.battKw, ac), rt = Math.sqrt(O.rte);
  let soc = cap, st;
  for (let pass = 0; pass < 2; pass++) {
    st = { unserved: 0, unH: 0, spill: 0, prod: 0, load: 0, woodBtu: 0, woodFuel: 0, hpBtu: 0, unmetHeat: 0, burnH: 0, consH: 0 };
    let conserving = false;
    const dayCons = trace ? Array(365).fill(0) : null;
    const mon = trace ? { prod: Array(12).fill(0), load: Array(12).fill(0), spill: Array(12).fill(0), wood: Array(12).fill(0), hp: Array(12).fill(0) } : null;
    const daySoc = trace ? Array(365).fill(1) : null;
    // The buffer as a heat store: E is Btu held above the hour's reset
    // temperature. The wood boiler charges it toward bufferMaxF whenever it
    // burns; heat is drawn from the store before the heat pump runs.
    const lbPerF = O.bufferGal * 8.34, maxF = O.bufferStore ? O.bufferMaxF : 0;
    let burning = false, E = 0;
    for (let i = 0; i < ctx.n; i++) {
      const m = ctx.month[i], p = Math.min(kw * ctx.pvDC[i] * O.eff, ac);
      if (Wc) { const fr = cap ? soc / cap : 0; if (fr < rule.on) conserving = true; else if (fr >= rule.off) conserving = false; }
      if (conserving) { st.consH++; if (dayCons) dayCons[Math.floor(i / 24)] = 1; }
      const X = conserving ? Wc : W;
      const Tw = W.tw[i], room = Math.max(0, lbPerF * (maxF - Tw));
      E = Math.min(E, room);
      // Hot water: the lower coil preheats toward the tank's temperature; the
      // electric tankless makes up the rest.
      const tank = Tw + E / lbPerF, dhw = W.dhw[i];
      const pre = W.chilled[i] ? 0 : dhw * clamp((Math.min(W.setF, tank - W.approach) - W.tin[i]) / (W.setF - W.tin[i]), 0, 1);
      const H = X.space[i] + pre;
      const frac = cap ? soc / cap : 0;
      if (frac < policy.socOn) burning = true; else if (frac >= policy.socOff) burning = false;
      const cold = policy.tF != null && ctx.T[i] < policy.tF;
      let wood = 0, hpq = 0, need = H;
      const fromStore = Math.min(need, E); E -= fromStore; need -= fromStore;
      if (burning || cold) {
        // Fire lit: serve the hour and bank the rest in the buffer.
        wood = Math.min(O.owbBtuh, need + (room - E)); const toStore = wood - Math.min(wood, need);
        need -= Math.min(wood, need); E += toStore;
      }
      hpq = Math.min(need, W.cap[i]); need -= hpq;
      if (need > 0) { const w2 = Math.min(need, O.owbBtuh - wood); wood += w2; need -= w2; st.unmetHeat += need; }
      const load = X.base[i] + (dhw - pre) / BTU + hpq / (W.cop[i] * BTU) + (wood > 0 ? O.owbPumpKw : 0) + ni * O.idleW / 1000;
      const lit = burning || cold || wood > 0;
      if (lit) { st.burnH++; st.woodFuel += wood / O.owbEff + O.owbIdleBtuh * Math.max(0, 1 - wood / O.owbBtuh); }
      st.woodBtu += wood; st.hpBtu += hpq;
      const net = p - load;
      if (net >= 0) { const ch = Math.min(net, bkw, (cap - soc) / rt); soc += ch * rt; st.spill += net - ch; if (mon) mon.spill[m] += net - ch; }
      else { let d2 = -net; const dis = Math.min(d2, bkw, soc * rt); soc -= dis / rt; d2 -= dis; if (d2 > 1e-6) { st.unserved += d2; st.unH++; } }
      st.prod += p; st.load += load;
      if (mon) { mon.prod[m] += p; mon.load[m] += load; mon.wood[m] += wood; mon.hp[m] += hpq; }
      if (daySoc) { const d = Math.floor(i / 24); daySoc[d] = Math.min(daySoc[d], cap ? soc / cap : 0); }
    }
    if (trace) { st.mon = mon; st.daySoc = daySoc; st.dayCons = dayCons; }
  }
  const cords = st.woodFuel / (O.cordMMBtu * 1e6);
  const capex = kw * s.capex.pvPerKw + s.capex.fixed + ni * O.inv + nb * O.batt + O.tons[tons].cost + s.hp.buffer + s.hp.controls + O.owb;
  let pvf = 0; for (let y = 1; y <= f.horizon; y++) pvf += (1 + r.escalation) ** (y - 1) / (1 + f.discount) ** y;
  const annual = cords * O.cordCost;
  const life = capex + nb * O.batt * O.battReplaceShare / (1 + f.discount) ** O.battLife + annual * pvf;
  return { ...design, ni, battKwh: nb * O.battKwh, capex, annual, life, cords, woodShare: st.woodBtu / Math.max(1, st.woodBtu + st.hpBtu), ...st };
}

// Cheapest C: each heat pump set and burn rule, with the smallest panels for
// each battery bank that never runs short of power or heat.
export function optimizeC(ctx, O = OFFGRID_INPUTS) {
  const kws = Array.from({ length: 30 }, (_, k) => 12 + 6 * k);
  const nbs = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 19, 22, 25, 28, 31, 34, 37, 40];
  const rows = [];
  const holds = x => x.unserved <= 1 && x.consH <= O.maxConsH;
  for (const tons of ['3.5', '6', '9.5', '12']) for (const policy of O.woodPolicies) {
    const row = { tons, label: O.tons[tons].label, policy, design: null };
    rows.push(row);
    for (const cons of ctx.cons ? O.consRules : [null]) for (const nb of nbs) {
      if (!holds(simulateC(ctx, { kw: kws.at(-1), nb, tons, policy, cons }, O))) continue;
      let lo = 0, hi = kws.length - 1, hit = null;
      while (lo <= hi) { const mid = (lo + hi) >> 1, x = simulateC(ctx, { kw: kws[mid], nb, tons, policy, cons }, O); if (holds(x)) { hit = x; hi = mid - 1; } else lo = mid + 1; }
      if (hit && hit.unmetHeat < 1e5 && (!row.design || hit.life < row.design.life)) row.design = hit;
    }
  }
  const ok = rows.filter(r => r.design).sort((a, b) => a.design.life - b.design.life);
  return { rows, best: ok.length ? simulateC(ctx, ok[0].design, O, true) : null };
}
