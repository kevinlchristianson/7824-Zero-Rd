// Off-grid designs for 7824 Zero Rd: no utility power, hour by hour on the
// Casper TMY3 year. Uses the solar model's loads (thermal model, household
// electricity, hot water) and its heat pump curves.
//
// Three rules for gas:
//   P  practical: gas stays. The Navien heats (the heat pump only on surplus
//      solar), the Modine heats the shop, and a gas generator covers any hour
//      the batteries run dry.
//   A  gas for about one week a year: the heat pumps carry all space heat,
//      electric resistance in the buffer covers what they can't while the
//      batteries last, and only then do the Navien (space heat) and generator
//      run: no more than 168 such hours a year. The Navien still makes hot
//      water on gas every day, from buffer-preheated cold water (owner).
//   B  no gas: space heat from heat pumps only, batteries only. Hot water
//      from the owner's electric tankless, fed buffer-preheated cold water.
//   A also needs at least 21 kW of panels (owner).

import { buildContext, loadsFor, SOLAR_INPUTS } from './solar.js';

export const OFFGRID_INPUTS = {
  inv: 3600, invAC: 12, invDC: 18, idleW: 70, eff: 0.969,   // refurbished EG4 18kPV (owner price)
  batt: 3400, battKwh: 16.1, dod: 0.9, rte: 0.92, battKw: 10, // EG4 indoor WallMount 314Ah (owner price)
  battLife: 15, battReplaceShare: 0.6,                        // assumed: replaced once, at 60% of today's price
  gen: 10000, genKw: 22, genKwhPerTherm: 5.3, genMaint: 300,  // 22 kW NG standby, installed; 203 cfh at half load
  elecBoiler: 2500,                                           // assumed: resistance element in the buffer (design A)
  tankless: 0,                                                // owner: electric tankless already installed (design B)
  minKwA: 21,                                                 // owner: design A starts from at least 21 kW
  maxBehindH: 30,                                             // assumed: design B may run behind setpoint up to ~a day, in the worst cold snap
  tons: {                                                     // heat pump sets (MBTEK less 20%) with install
    '3.5': { tons: 3.5, cost: 4138 + 1500, label: 'One 3.5-ton' },
    '6': { tons: 6, cost: 5816 + 1500, label: 'One 6-ton' },
    '9.5': { tons: 9.5, cost: 4138 + 5816 + 3000, label: '3.5-ton + 6-ton' },
    '12': { tons: 12, cost: 2 * 5816 + 3000, label: 'Two 6-tons' },
    '18': { tons: 18, cost: 3 * 5816 + 4500, label: 'Three 6-tons' },
    '24': { tons: 24, cost: 4 * 5816 + 6000, label: 'Four 6-tons' },
    '30': { tons: 30, cost: 5 * 5816 + 7500, label: 'Five 6-tons' },
    '36': { tons: 36, cost: 6 * 5816 + 9000, label: 'Six 6-tons' },
  },
};

const BTU = 3412, clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function offgridContext(wx, s = SOLAR_INPUTS) {
  const ctx = buildContext(wx, s), hp = s.hp, pl = ctx.plant;
  const R0 = hp.reset;
  const tankF = T => clamp(R0.lowF + (R0.lowAtF - T) * (R0.highF - R0.lowF) / (R0.lowAtF - R0.highAtF), R0.lowF, R0.highF);
  const copAt = T => clamp(hp.derate * (T >= 17 ? hp.cop17 + (T - 17) * (hp.cop47 - hp.cop17) / 30 : hp.cop5 + (T - 5) * (hp.cop17 - hp.cop5) / 12), 1, hp.cop47 * 1.3);
  const capAt = T => Math.max(0, hp.cap10 + (T - 10) * (hp.cap47 - hp.cap10) / 37);
  const copF = Tw => Math.max(0.3, 1 - hp.copPerF * (Tw - hp.ratedWaterF)), capF = Tw => Math.max(0.3, 1 - hp.capPerF * (Tw - hp.ratedWaterF));
  const distKW = (pl.fanW + pl.pumpW) / 1000, coolRate = 72000;
  // All-electric loads for a heat pump size: electricity for everything the
  // heat pumps can do (hot-water top-up on an element), and the heat left.
  // rule 'A': hot-water top-up on the Navien (gas); 'B': on the electric
  // tankless, and heat the heat pumps owe is carried forward.
  ctx.allElectric = (tons, rule) => {
    const hpwh = rule === 'B';
    const n = ctx.n, e = new Float64Array(n), left = new Float64Array(n), dhwGas = new Float64Array(n);
    // With heat pumps only (B), heat they can't deliver this hour is owed and
    // delivered later: warm-ups and cold snaps just take longer.
    let short = 0, debt = 0, run = 0, longest = 0, behindH = 0, maxDebt = 0;
    for (let i = 0; i < n; i++) {
      const T = ctx.T[i], Tw = tankF(T), cool = Math.min(ctx.cool[i], coolRate);
      let x = ctx.dom[i] + cool / (4.6 * BTU) + (cool > 0 ? cool / coolRate * distKW : 0);
      const space = ctx.zone.shop[i] + ctx.zone.ground[i] + ctx.zone.upper[i], dhw = ctx.dhw[i];
      x += space / pl.ahuHeatBtuh * distKW;
      const cap = T >= hp.minT ? capAt(T) * tons / 6 * capF(Tw) : 0, cop = Math.max(1, copAt(T) * copF(Tw));
      // Hot water: the buffer preheats the cold feed; the Navien (A) or the
      // electric tankless (B) takes it the rest of the way.
      const pre = cool > 0 ? 0 : dhw * clamp((Math.min(s.dhw.setF, Tw - 10) - ctx.tin[i]) / (s.dhw.setF - ctx.tin[i]), 0, 1);
      const want = space + pre + (hpwh ? debt : 0), q = Math.min(want, cap);
      x += q / (cop * BTU);
      if (rule === 'A') dhwGas[i] = (dhw - pre) / s.dhw.eff / 1e5; else x += (dhw - pre) / BTU;
      e[i] = x;
      if (hpwh) {
        debt = want - q; left[i] = 0;
        if (debt > 1000) { behindH++; run++; longest = Math.max(longest, run); maxDebt = Math.max(maxDebt, debt); } else run = 0;
      } else left[i] = space + pre - q;
      if (left[i] > 1000) short++;
    }
    return { e, left, dhwGas, short: hpwh ? behindH : short, behindH, longest, maxDebt };
  };
  return ctx;
}

// One year off grid. design: { rule: 'P'|'A'|'B', tons, kw, nb, gen }
export function simulate(ctx, design, O = OFFGRID_INPUTS, trace = false) {
  const s = ctx.s, r = s.rates, f = s.finance, { rule, kw, nb } = design;
  const T = O.tons[design.tons];
  const ni = Math.max(2, Math.ceil(kw / O.invDC)), ac = ni * O.invAC, cap = nb * O.battKwh * O.dod, bkw = Math.min(nb * O.battKw, ac), rt = Math.sqrt(O.rte);
  const gen = rule !== 'B';
  let P = null, H = null, L = null;
  if (rule === 'P') { P = loadsFor(ctx, `c35.cool.1`); H = loadsFor(ctx, `c35.hp.1`); }
  else L = (ctx._ae ??= {})[rule + design.tons] ??= ctx.allElectric(T.tons, rule);
  let soc = cap, st;
  const n = ctx.n;
  for (let pass = 0; pass < 2; pass++) {
    st = { gasH: 0, genKwh: 0, navTh: 0, unserved: 0, unH: 0, resKwh: 0, spill: 0, prod: 0, used: 0, load: 0, hpBtu: 0, dhwTh: 0 };
    const mon = trace ? { prod: Array(12).fill(0), load: Array(12).fill(0), gen: Array(12).fill(0), spill: Array(12).fill(0), gas: Array(12).fill(0) } : null;
    const daySoc = trace ? Array(365).fill(1) : null;
    for (let i = 0; i < n; i++) {
      const m = ctx.month[i];
      const p = Math.min(kw * ctx.pvDC[i] * O.eff, ac);
      let load, g = 0, gasHour = false, res = 0;
      if (rule === 'P') { load = P.elec[i]; g = P.gas[i]; }
      else if (rule === 'A') { load = L.e[i]; res = L.left[i] / BTU; g = L.dhwGas[i]; st.dhwTh += g; }
      else {
        load = L.e[i];
      }
      load += ni * O.idleW / 1000;
      let net = p - load - res;
      if (rule === 'A' && res > 0 && net < 0 && soc * rt < -net) {
        net += res; g += L.left[i] / 0.93 / 1e5; st.navTh += L.left[i] / 0.93 / 1e5; gasHour = true; res = 0;
      }
      st.resKwh += res;
      if (net >= 0) {
        const ch = Math.min(net, bkw, (cap - soc) / rt); soc += ch * rt; net -= ch;
        if (rule === 'P' && net > 0) {      // full batteries: surplus runs the heat pump instead of gas
          const dE = H.elec[i] - P.elec[i], dG = P.gas[i] - H.gas[i];
          if (dE > 0 && dG > 0) { const fr = Math.min(1, net / dE); net -= fr * dE; g -= fr * dG; st.hpBtu += fr * dG * 1e5 * 0.93; load += fr * dE; }
        }
        st.spill += net; if (mon) mon.spill[m] += net;
      } else {
        let need = -net;
        const dis = Math.min(need, bkw, soc * rt); soc -= dis / rt; need -= dis;
        if (need > 1e-6) {
          if (gen) {
            const gk = Math.min(O.genKw, need + Math.max(0, (cap * 0.5 - soc) / rt));
            st.genKwh += gk; soc += Math.max(0, gk - need) * rt; gasHour = true; if (mon) mon.gen[m] += gk;
            if (gk < need - 1e-6) { st.unserved += need - gk; st.unH++; }
          } else { st.unserved += need; st.unH++; }
        }
      }
      if (rule !== 'B') st.navTh += rule === 'P' ? g : 0;
      if (gasHour) st.gasH++;
      st.prod += p; st.load += load + res;
      if (mon) { mon.prod[m] += p; mon.load[m] += load + res; mon.gas[m] += g; }
      if (daySoc) { const d = Math.floor(i / 24); daySoc[d] = Math.min(daySoc[d], cap ? soc / cap : 0); }
    }
    if (trace) { st.mon = mon; st.daySoc = daySoc; }
  }
  const capex = kw * s.capex.pvPerKw + s.capex.fixed + ni * O.inv + nb * O.batt + (gen ? O.gen : 0)
    + (rule === 'P' ? loadsFor(ctx, 'c35.cool.1').cost : T.cost + s.hp.buffer + s.hp.controls + (rule === 'A' ? O.elecBoiler : O.tankless));
  const genTh = st.genKwh / O.genKwhPerTherm;
  const annual = rule === 'B' ? 0 : (st.navTh + st.dhwTh + genTh) * r.gas + 12 * r.gasFixed + O.genMaint;
  let pvf = 0; for (let y = 1; y <= f.horizon; y++) pvf += (1 + r.escalation) ** (y - 1) / (1 + f.discount) ** y;
  const life = capex + nb * O.batt * O.battReplaceShare / (1 + f.discount) ** O.battLife + annual * pvf;
  return { ...design, ni, battKwh: nb * O.battKwh, capex, annual, life, genTh, ...st,
    behindH: L?.behindH ?? 0, longestBehind: L?.longest ?? 0, maxDebt: L?.maxDebt ?? 0 };
}

// Cheapest design meeting a rule: P and B need zero unserved; A also caps
// gas hours at 168.
export function cheapest(ctx, rule, tons, grid = {}) {
  const kws = (grid.kws ?? Array.from({ length: 31 }, (_, k) => 18 + 6 * k)).filter(kw => rule !== 'A' || kw >= OFFGRID_INPUTS.minKwA);
  if (rule === 'A' && !kws.includes(OFFGRID_INPUTS.minKwA)) kws.unshift(OFFGRID_INPUTS.minKwA);
  const nbs = grid.nbs ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58, 61];
  let best = null;
  for (const kw of kws) for (const nb of nbs) {
    const x = simulate(ctx, { rule, tons, kw, nb });
    const ok = x.unserved < 1 && (rule !== 'A' || x.gasH <= 168) && (rule !== 'B' || x.longestBehind <= OFFGRID_INPUTS.maxBehindH);
    if (ok && (!best || x.life < best.life)) best = x;
  }
  return best;
}
