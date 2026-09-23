// Cash flow toward design C: the owner's Financial_Scenarios_Model workbook
// (S13 "HoldMtg Rent2nd" path) rebuilt month by month, with reno-1 at $250k
// on a $250k interest-only HELOC, two $50k gifts, and the energy steps bought
// on different schedules. Writes data/finance.json. Usage: npm run finance
import { writeFileSync } from 'node:fs';

// From the workbook's Assumptions sheet unless marked.
export const F = {
  start: { y: 2026, m: 6 },                       // month 0 = Jun 2026; month 1 = Jul 2026
  months: 240,
  brokerage0: 51830.28, cashToClose: 15000,       // paid from brokerage at month 0; not reimbursed (line is full)
  truck: { bal: 26604.45, apr: 0.0899, pmt: 1538.70 },
  wf: { bal: 12116.75, min: 122, payoffMonth: 18 },
  usb: { bal: 23431, min: 235, payoffMonth: 20 },
  mtg: { bal: 247626.76, apr: 0.02875, pmt: 1453.32 },
  rental: { net: 1986.77 - 400, rent2: 1100, rent2From: 8, /* owner: second-dwelling rent starts Feb 2027 */ value: 400000, appr: 0.03, commission: 0.04, basis: 299000, capGains: 0.15, recapture: 12500 },
  heloc: { limit: 250000, apr: 0.07, reno1: 250000, reno2: 100000, reno2At: 100000 },   // owner: reno-1 grew to $250k
  paycheck: 1500, paycheckSold: 2000, inflation: 0.025, ret: 0.08, floor: 20000, payoffCushion: 50000,   // workbook: $2,000/mo once the rental is sold
  sellMonth: 3,                                    // workbook's sell scenarios close in month 3 (Sep 2026)
  floorTopUp: 7000,                                // from gift 1: the $15k cash-to-close is no longer reimbursed, so the card payoffs would breach the floor
  gifts: [{ month: 6, amt: 50000 }, { month: 12, amt: 50000 }],                          // owner: Dec 2026, Jun 2027
  card: { limit: 20000, months: 18, fee: 0.03 },                                        // owner: one 0% card; fee assumed
  escalation: 0.033,
};

// Energy steps toward design C (solar model, owner prices). Savings are
// yearly bill changes at today's rates; wood is a resilience purchase that
// costs more than the gas it replaces while the grid is connected.
export const STEPS = {
  solar: { label: '21 kW on two refurbished 18kPVs', cost: 23590, saves: 2237 },
  hp: { label: '3.5-ton Apollo, buffer, controls', cost: 10028, saves: 164 },
  batt: { label: '32 kWh of batteries (outage kit)', cost: 6800, saves: 0 },
  wood: { label: 'Outdoor wood boiler', cost: 18000, saves: 473 - 7.3 * 150 },   // gas saved less ~7.3 cords at a $150 blend
};

const dateOf = m => { const t = F.start.m - 1 + m; return { y: F.start.y + Math.floor(t / 12), m: (t % 12) + 1 }; };
const label = m => { const d = dateOf(m); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.m - 1]} ${d.y}`; };

// plan: { gifts: [{ month, uses: [['loc'|'brok'|step, amount|'rest']] }],
//         buys: [{ step, month, via: 'heloc'|'card'|'brok' }] }
export function run(plan, opts = {}) {
  const ret = opts.ret ?? F.ret, r12 = ret / 12;
  let brok = F.brokerage0 - F.cashToClose, truck = F.truck.bal, wf = F.wf.bal, usb = F.usb.bal, mtg = F.mtg.bal;
  let loc = 0, reno2Fired = false, sold = false, value = F.rental.value, mtgDone = false;
  const cards = [];                      // { bal, due }
  const owned = {}, log = [], events = [];
  let interest = 0, cumPay = 0, cumSave = 0, minBrok = Infinity, brokPayoff = null;
  const buysLeft = [...(plan.buys ?? [])].sort((a, b) => a.month - b.month);
  // HELOC-first plans: optional early sale, reno-2 deferred to its own line,
  // then one 7% line per phase in order, each opened when the previous closes.
  const phases = [...(plan.phases ?? [])];
  let phase = null, helocClosed = null;
  const reno2Deferred = !!plan.phases;
  for (let t = 1; t <= F.months; t++) {
    const yrs = (t - 1) / 12, infl = (1 + F.inflation) ** yrs, esc = (1 + F.escalation) ** yrs;
    if (t === 1) loc = Math.min(F.heloc.reno1, F.heloc.limit);
    // Interest for the month.
    const iTruck = truck * F.truck.apr / 12, iMtg = mtg * F.mtg.apr / 12, iLoc = loc * F.heloc.apr / 12;
    interest += iTruck + iLoc;
    // Required payments.
    let req = 0;
    if (truck > 0) { const p = Math.min(F.truck.pmt, truck + iTruck); truck = truck + iTruck - p; req += p; }
    if (!sold && mtg > 0) { const p = Math.min(F.mtg.pmt, mtg + iMtg); mtg = mtg + iMtg - p; req += p; }
    if (wf > 0) { const p = Math.min(F.wf.min, wf); wf -= p; req += p; }
    if (usb > 0) { const p = Math.min(F.usb.min, usb); usb -= p; req += p; }
    req += iLoc;                          // interest-only HELOC
    // Income and the paycheck.
    // Forced early sale: equity pays the truck, then the HELOC.
    if (plan.sellMonth && t === plan.sellMonth && !sold) {
      value = F.rental.value * (1 + F.rental.appr) ** (t / 12);
      const gross = value * (1 - F.rental.commission), tax = F.rental.capGains * Math.max(0, gross - F.rental.basis) + F.rental.recapture;
      let cash = gross - tax - mtg; mtg = 0; sold = true;
      const pt = Math.min(cash, truck); truck -= pt; cash -= pt;
      const pl = Math.min(cash, loc); loc -= pl; cash -= pl;
      brok += cash; events.push({ month: t, what: `Rental sold: ${Math.round(pt) ? 'truck paid, ' : ''}${'$' + Math.round(pl).toLocaleString('en-US')} to the HELOC`, amt: pt + pl + cash });
    }
    const rentalNet = sold ? 0 : (F.rental.net + (t >= F.rental.rent2From ? F.rental.rent2 : 0)) * infl;
    let save = 0; for (const k of Object.keys(owned)) save += STEPS[k].saves / 12 * esc;
    cumSave += save;
    if (phase) { const ip = phase.bal * F.heloc.apr / 12; interest += ip; req += ip; }
    const pay = Math.max(plan.sellMonth ? F.paycheckSold : F.paycheck, req - rentalNet - save);   // workbook: $2,000/mo only in the sell-now scenarios
    cumPay += pay;
    let surplus = rentalNet + save + pay - req;
    // Lumps: card payoffs at their 0% deadlines, energy purchases, gifts.
    if (t === F.wf.payoffMonth && wf > 0) { brok -= wf; wf = 0; }
    if (t === F.usb.payoffMonth && usb > 0) { brok -= usb; usb = 0; }
    for (const g of F.gifts.filter(g => g.month === t)) {
      const uses = [...(t === 6 ? [['brok', F.floorTopUp]] : []), ...((plan.gifts ?? {})[t] ?? [['loc', 'rest']])];
      let left = g.amt;
      for (const [use, amt] of uses) {
        const a = amt === 'rest' ? left : Math.min(amt, left);
        if (use === 'loc') { const p = Math.min(a, loc); loc -= p; left -= p; }
        else if (use === 'brok') { brok += a; left -= a; }
        else if (STEPS[use] && !owned[use]) { const c = STEPS[use].cost; if (a >= c) { owned[use] = t; left -= c; events.push({ month: t, what: `${STEPS[use].label} from gift`, amt: c }); } }
      }
      if (left > 0) brok += left;
      events.push({ month: t, what: 'Gift', amt: g.amt });
    }
    while (buysLeft.length && buysLeft[0].month <= t) {
      const b = buysLeft[0], c = STEPS[b.step].cost;
      if (owned[b.step]) { buysLeft.shift(); continue; }
      if (b.via === 'heloc') { if (loc + c <= F.heloc.limit) { loc += c; owned[b.step] = t; buysLeft.shift(); events.push({ month: t, what: `${STEPS[b.step].label} on the HELOC`, amt: c }); } else break; }
      else if (b.via === 'card') { const onCard = Math.min(c, F.card.limit); if (brok - (c - onCard) >= F.floor) { cards.push({ bal: onCard * (1 + F.card.fee), due: t + F.card.months }); brok -= c - onCard; interest += onCard * F.card.fee; owned[b.step] = t; buysLeft.shift(); events.push({ month: t, what: `${STEPS[b.step].label} on a 0% card`, amt: c }); } else break; }
      else { if (brok - c >= F.floor) { brok -= c; owned[b.step] = t; buysLeft.shift(); events.push({ month: t, what: `${STEPS[b.step].label} from brokerage`, amt: c }); } else break; }
    }
    for (const cd of cards) if (cd.bal > 0 && t >= cd.due) {
      // Balloon: brokerage if the floor holds, else the HELOC.
      if (brok - cd.bal >= F.floor) brok -= cd.bal; else loc += cd.bal;
      events.push({ month: t, what: 'Card balloon paid', amt: cd.bal }); cd.bal = 0;
    }
    // Surplus waterfall: HELOC, then mortgage prepay once the line is dead, then brokerage.
    if (surplus > 0) {
      if (loc > 0) { const p = Math.min(surplus, loc); loc -= p; surplus -= p; }
      if (surplus > 0 && phase) { const p = Math.min(surplus, phase.bal); phase.bal -= p; surplus -= p; }
      if (surplus > 0 && loc <= 0 && reno2Fired && !sold && mtg > 0) { const p = Math.min(surplus, mtg); mtg -= p; surplus -= p; }
      brok += surplus;
    } else brok += surplus;
    // HELOC-first: the line closes, then phases open one at a time.
    if (reno2Deferred) {
      if (loc <= 0 && !helocClosed) { helocClosed = t; events.push({ month: t, what: 'Renovation HELOC closed', amt: 0 }); }
      if (phase && phase.bal <= 0) { events.push({ month: t, what: `${phase.name} line paid off`, amt: 0 }); phase = null; }
      if (helocClosed && !phase && phases.length) {
        const ph = phases.shift(); phase = { name: ph.name, bal: ph.amount };
        if (ph.step) owned[ph.step] = t; if (ph.reno2) reno2Fired = true;
        events.push({ month: t, what: `${ph.name} on its own 7% line`, amt: ph.amount });
      }
    }
    // Reno-2 fires when the line first drops to its trigger.
    if (!reno2Deferred && !reno2Fired && loc <= F.heloc.reno2At) { loc += F.heloc.reno2; reno2Fired = true; events.push({ month: t, what: 'Reno-2 (lower level) draws', amt: F.heloc.reno2 }); }
    // Brokerage pays the line off when it can keep the cushion.
    if (!reno2Deferred && loc > 0 && brok >= loc + (reno2Fired ? 0 : F.heloc.reno2) + F.payoffCushion) {
      brok -= loc; if (!reno2Fired) { brok -= F.heloc.reno2; reno2Fired = true; } loc = 0; brokPayoff = t; events.push({ month: t, what: 'Brokerage pays off the HELOC', amt: 0 });
    }
    // Sell the rental the month the mortgage settles.
    value = F.rental.value * (1 + F.rental.appr) ** (t / 12);
    if (!sold && mtg <= 0 && reno2Fired && loc <= 0 && !phase && !phases.length) {
      const gross = value * (1 - F.rental.commission), tax = F.rental.capGains * Math.max(0, gross - F.rental.basis) + F.rental.recapture;
      brok += gross - tax; sold = true; mtgDone = true; events.push({ month: t, what: 'Rental sold', amt: gross - tax });
    }
    brok *= 1 + r12;
    minBrok = Math.min(minBrok, brok);
    const pb = phase ? phase.bal : 0;
    const debt = truck + wf + usb + loc + pb + (sold ? 0 : mtg) + cards.reduce((a, c) => a + c.bal, 0);
    const nw = brok + (sold ? 0 : value - mtg) - truck - wf - usb - loc - pb - cards.reduce((a, c) => a + c.bal, 0);
    log.push({ t, brok, loc: loc + pb, mtg: sold ? 0 : mtg, truck, cc: wf + usb, nw, debt });
  }
  const first = f => { const x = log.find(f); return x ? x.t : null; };
  const debtFree = first(x => x.debt < 1), locDead = helocClosed ?? first(x => x.t > 1 && x.loc < 1 && reno2Fired), consumerFree = first(x => x.truck + x.cc < 1);
  return { plan, log, events, owned, interest, cumPay, cumSave, minBrok, brokPayoff, debtFree, locDead, helocClosed, consumerFree,
    nwEnd: log.at(-1).nw, nwNet: log.at(-1).nw - cumPay, nwAtDebtFree: debtFree ? log[debtFree - 1].nw : null, sold: events.find(e => e.what === 'Rental sold')?.month ?? null };
}

// ---------------------------------------------------------------- schedules
export const PLANS = {
  base: { name: 'Workbook path, no energy', note: 'S13 as built, with reno-1 at $250k. Both gifts pay the HELOC.', gifts: {}, buys: [] },
  solarGift: { name: 'Solar from gift 1, nothing else', note: 'Dec 2026 gift buys the 21 kW array; the rest of both gifts pays the HELOC. No heat pump, batteries or boiler.',
    gifts: { 6: [['solar', STEPS.solar.cost], ['loc', 'rest']] }, buys: [] },
  solarCard: { name: 'Solar now on the 0% card, nothing else', note: 'Array in Oct 2026 on the $20k card plus $3.6k of brokerage; both gifts pay the HELOC; the Apr 2028 balloon comes from brokerage or the line.',
    gifts: {}, buys: [{ step: 'solar', month: 4, via: 'card' }] },
  cGifts: { name: 'C-capable by fall 2027, from the gifts', note: 'Gift 1: solar, rest to the HELOC. Gift 2: heat pump, buffer, batteries, rest to the HELOC. Wood boiler on the HELOC in Oct 2027.',
    gifts: { 6: [['solar', STEPS.solar.cost], ['loc', 'rest']], 12: [['hp', STEPS.hp.cost], ['batt', STEPS.batt.cost], ['loc', 'rest']] }, buys: [{ step: 'wood', month: 16, via: 'heloc' }] },
  cCard: { name: 'C-capable by fall 2027, solar on the card', note: 'Solar on the card in Oct 2026; gift 1 buys the heat pump, buffer and batteries and pays the line; gift 2 buys the wood boiler and pays the line.',
    gifts: { 6: [['hp', STEPS.hp.cost], ['batt', STEPS.batt.cost], ['loc', 'rest']], 12: [['wood', STEPS.wood.cost], ['loc', 'rest']] }, buys: [{ step: 'solar', month: 4, via: 'card' }] },
  cLate: { name: 'Solar now, the rest when the line dies', note: 'Solar from gift 1; heat pump, batteries and boiler bought from brokerage once the HELOC is gone.',
    gifts: { 6: [['solar', STEPS.solar.cost], ['loc', 'rest']] }, buys: [{ step: 'hp', month: 130, via: 'brok' }, { step: 'batt', month: 130, via: 'brok' }, { step: 'wood', month: 130, via: 'brok' }] },
  helocFirstSell: { name: 'Close the HELOC first: sell the rental now', note: 'Rental sold Sep 2026; equity pays the truck, then the HELOC. Both gifts and all surplus ($2,000/mo paycheck) go to the HELOC; reno-2 waits. After it closes, one 7% line per phase in turn: solar, lower level, heat pump, batteries and boiler.',
    gifts: {}, buys: [], sellMonth: F.sellMonth, phases: [{ name: 'Solar', amount: STEPS.solar.cost, step: 'solar' }, { name: 'Lower-level renovation', amount: F.heloc.reno2, reno2: true }, { name: 'Heat pump and buffer', amount: STEPS.hp.cost, step: 'hp' }, { name: 'Batteries', amount: STEPS.batt.cost, step: 'batt' }, { name: 'Wood boiler', amount: STEPS.wood.cost, step: 'wood' }] },
  helocFirstKeep: { name: 'Close the HELOC first: keep the rental', note: 'Same waterfall without the sale: gifts and surplus to the HELOC, reno-2 deferred to its own line, then the phases in turn; the rental sells when its mortgage is prepaid.',
    gifts: {}, buys: [], phases: [{ name: 'Solar', amount: STEPS.solar.cost, step: 'solar' }, { name: 'Lower-level renovation', amount: F.heloc.reno2, reno2: true }, { name: 'Heat pump and buffer', amount: STEPS.hp.cost, step: 'hp' }, { name: 'Batteries', amount: STEPS.batt.cost, step: 'batt' }, { name: 'Wood boiler', amount: STEPS.wood.cost, step: 'wood' }] },
  cStaged: { name: 'Solar now, heat pump 2028, batteries and boiler 2030', note: 'Solar from gift 1; the heat pump on the HELOC in spring 2028; batteries and boiler on the HELOC in fall 2030.',
    gifts: { 6: [['solar', STEPS.solar.cost], ['loc', 'rest']] }, buys: [{ step: 'hp', month: 22, via: 'heloc' }, { step: 'batt', month: 52, via: 'heloc' }, { step: 'wood', month: 52, via: 'heloc' }] },
};

const $ = v => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
const out = { F, STEPS, plans: {} };
for (const [id, plan] of Object.entries(PLANS)) {
  const r = run(plan), r6 = run(plan, { ret: 0.06 });
  out.plans[id] = { ...plan, events: r.events.map(e => ({ ...e, date: label(e.month) })), owned: Object.fromEntries(Object.entries(r.owned).map(([k, m]) => [k, label(m)])),
    interest: r.interest, cumPay: r.cumPay, cumSave: r.cumSave, minBrok: r.minBrok, minBrok6: r6.minBrok, locDead: r.locDead && label(r.locDead), debtFree: r.debtFree && label(r.debtFree),
    consumerFree: r.consumerFree && label(r.consumerFree), sold: r.sold && label(r.sold), nwEnd: r.nwEnd, nwEnd6: r6.nwEnd, nwNet: r.nwNet, nwNet6: r6.nwNet, nwAtDebtFree: r.nwAtDebtFree,
    series: r.log.filter(x => x.t % 3 === 0).map(x => ({ t: x.t, loc: Math.round(x.loc), mtg: Math.round(x.mtg), other: Math.round(x.truck + x.cc), brok: Math.round(x.brok), nw: Math.round(x.nw) })) };
  console.log(`${plan.name.padEnd(44)} HELOC closed ${r.helocClosed ? label(r.helocClosed) : '—'} | steps ${Object.entries(r.owned).map(([k, m]) => `${k} ${label(m)}`).join(', ') || 'none'} | consumer-free ${label(r.consumerFree)}, line dead ${r.locDead ? label(r.locDead) : '—'}, debt-free ${r.debtFree ? label(r.debtFree) : '—'}, sold ${r.sold ? label(r.sold) : '—'} | interest ${$(r.interest)}, saved ${$(r.cumSave)}, paycheck ${$(r.cumPay)}, min brok ${$(r.minBrok)} | NW 2046 ${$(r.nwEnd)}, net of paycheck ${$(r.nwNet)} (6%: ${$(r6.nwNet)})`);
}
writeFileSync(new URL('../data/finance.json', import.meta.url), JSON.stringify(out));
console.log('wrote data/finance.json');
