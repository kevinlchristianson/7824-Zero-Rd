// Financial model for 7824 Zero Rd: month-by-month cash flow from whatever
// month the balances are "as of", so it can be restarted from every check-in.
// It rebuilds the owner's cash-flow workbook (the S13 "hold the rental, rent
// the second unit" path) with the $250k renovation on the interest-only
// HELOC, the two gifts, and the energy phases toward design C, and adds the
// owner's HELOC-first rule: kill the renovation line, then give each phase its
// own 7% line in turn. Runs in the browser and in node. No DOM here.

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const calOf = ym => { const [y, m] = ym.split('-').map(Number); return y * 12 + m - 1; };
export const ymOf = n => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
export const labelOf = n => `${MON[n % 12]} ${Math.floor(n / 12)}`;

// Balances are at the end of `asOf`. Workbook values unless marked.
export const FIN_INPUTS = {
  asOf: '2026-06',
  note: 'Workbook starting balances',
  horizonYears: 20,
  accounts: {
    brokerage: 36830.28,                                  // $51,830.28 less the $15k cash to close (not reimbursed: the line is full)
    heloc: 250000, helocLimit: 250000, helocApr: 0.07,    // owner: reno-1 at $250k fills the line, interest-only
    mortgage: 247626.76, mortgageApr: 0.02875, mortgagePmt: 1453.32,
    truck: 26604.45, truckApr: 0.0899, truckPmt: 1538.70,
    wf: 12116.75, wfMin: 122, wfDue: '2027-12',           // 0% until the due month, then paid in full
    usb: 23431, usbMin: 235, usbDue: '2028-02',
    rentalValue: 400000, rentalSold: false,
  },
  income: {
    rentalNet: 1586.77,                                   // $1,986.77 less $400 reserve
    rent2: 1100, rent2From: '2027-02',                    // owner: second-dwelling rent from Feb 2027
    paycheck: 1500, paycheckSold: 2000,                   // owner: $1,500 is about the real maximum; the workbook's sell-now case uses $2,000
    inflation: 0.025,
  },
  gifts: [                                                // owner: free to allocate; the rest goes to the debt being paid down
    { month: '2026-12', amount: 50000, keep: 7000 },      // $7k tops brokerage up so the card payoffs keep the floor
    { month: '2027-06', amount: 50000, keep: 0 },
  ],
  strategy: {
    mode: 'separate',        // 'separate': close the HELOC, then one line per phase; 'redraw': each phase redraws the HELOC when it falls to redrawAt
    redrawAt: 100000,
    phaseApr: 0.07,          // owner: a new HELOC for each phase, taken out once the renovation line is gone
    // Owner: killing the renovation HELOC is priority one, even if it means
    // selling the rental. December 2026 is assumed as the first realistic close.
    sell: 'onDate',          // 'onDate'; 'afterPayoff': sell the month the rental mortgage is prepaid; 'never'
    sellOn: '2026-12',
    prepayMortgage: true,    // once every phase is paid, surplus prepays the rental mortgage
    refillFloor: true,       // surplus, and gifts, refill brokerage first while it is under the floor
    shortfall: 'brokerage',  // when rent and savings don't cover the payments: 'brokerage' (owner: $1,500 is about the real maximum) or 'paycheck' (workbook: the paycheck covers it all)
    floor: 20000, ret: 0.08,
    brokPayoff: false, cushion: 50000,   // workbook rule: brokerage pays a line off when it can keep the cushion
    autoKeep: true,          // hold back enough of the gift before a brokerage low to keep the floor
    truckFirst: true,        // gifts and surplus pay off the 8.99% truck before the 7% HELOC (owner asked)
  },
  rental: { appr: 0.03, commission: 0.04, basis: 299000, capGains: 0.15, recapture: 12500 },
  escalation: 0.033,         // energy savings grow with utility rates
  // Phases after the renovation, in order. status: pending | open (bal is its
  // line's balance) | done. saves: yearly bill change at today's rates.
  phases: [
    { id: 'solar', name: 'Solar: 72 × 440 W on the shop roof, two 18kPVs', amount: 29891, saves: 2691, status: 'pending', bal: 0 },
    { id: 'reno2', name: 'Lower-level renovation', amount: 100000, saves: 0, status: 'pending', bal: 0 },
    { id: 'hp', name: 'Heat pump, buffer and controls', amount: 10028, saves: 173, status: 'pending', bal: 0 },
    { id: 'batt', name: 'Batteries (32 kWh outage kit)', amount: 6800, saves: 0, status: 'pending', bal: 0 },
    { id: 'wood', name: 'Outdoor wood boiler', amount: 18000, saves: -622, status: 'pending', bal: 0 },
  ],
};

// Every debt the model tracks, for amortization.
export const DEBTS = [
  ['heloc', 'Renovation HELOC'], ['mortgage', 'Rental mortgage'], ['truck', 'Truck loan'], ['wf', 'Wells Fargo card'], ['usb', 'US Bank card'],
];

const clone = o => JSON.parse(JSON.stringify(o));

// With autoKeep, a gift that lands before brokerage dips under the floor
// keeps enough back to hold it (a few passes, since keeping changes the path).
export function simulate(inp) {
  let I = clone(inp), sim = simCore(I);
  if (!I.strategy.autoKeep) return sim;
  for (let pass = 0; pass < 4; pass++) {
    const low = sim.summary.minBrok, short = I.strategy.floor - low.v;
    if (short < 1) break;
    const n0 = calOf(I.asOf), g = I.gifts.filter(x => x.amount > 0 && calOf(x.month) > n0 && calOf(x.month) <= low.cal).at(-1);
    if (!g || g.keep >= g.amount) break;
    const grow = (1 + I.strategy.ret / 12) ** (low.cal - calOf(g.month));
    g.keep = Math.min(g.amount, Math.ceil((g.keep + short / grow) / 100) * 100);
    sim = simCore(I);
  }
  return sim;
}

function simCore(inp) {
  const I = clone(inp), A = I.accounts, S = I.strategy, R = I.rental, n0 = calOf(I.asOf), T = I.horizonYears * 12;
  const wfDue = calOf(A.wfDue), usbDue = calOf(A.usbDue), rent2From = calOf(I.income.rent2From), sellOn = calOf(S.sellOn);
  let brok = A.brokerage, heloc = A.heloc, mtg = A.mortgage, truck = A.truck, wf = A.wf, usb = A.usb, sold = !!A.rentalSold;
  const phases = I.phases.map(p => ({ ...p, bal: p.status === 'open' ? p.bal : 0 }));
  let helocClosed = heloc <= 0.5 && I.strategy.mode === 'separate' ? n0 : null;
  const gifts = I.gifts.filter(g => g.amount > 0 && calOf(g.month) > n0);
  const amort = {};                                   // key -> per-month { bal0, draw, interest, principal, bal }
  const track = key => (amort[key] ??= Array.from({ length: T }, () => ({ bal0: 0, draw: 0, interest: 0, principal: 0, bal: 0 })));
  for (const [k] of DEBTS) track(k);
  for (const p of phases) track('ph:' + p.id);
  const rows = [], events = [];
  const ev = (t, kind, what, amt = 0, extra = {}) => events.push({ cal: n0 + t, t, kind, what, amt, ...extra });
  let interestPaid = 0, paycheckIn = 0, saved = 0, minBrok = { v: brok, cal: n0 };
  let floorHits = 0;
  const openPhase = () => phases.find(p => p.status === 'open');

  for (let t = 1; t <= T; t++) {
    const cal = n0 + t, yrs = (t - 1) / 12, k = t - 1;
    const infl = (1 + I.income.inflation) ** yrs, esc = (1 + I.escalation) ** yrs;
    const row = { t, cal, lumps: [], pay: {}, extra: {} };
    for (const [key] of DEBTS) track(key)[k].bal0 = { heloc, mortgage: mtg, truck, wf, usb }[key];
    for (const p of phases) track('ph:' + p.id)[k].bal0 = p.bal;

    // Interest and required payments.
    const req = {};
    const iTruck = truck * A.truckApr / 12, iMtg = sold ? 0 : mtg * A.mortgageApr / 12, iHeloc = heloc * A.helocApr / 12;
    if (truck > 0) { const p = Math.min(A.truckPmt, truck + iTruck); req.truck = p; amort.truck[k].interest = iTruck; amort.truck[k].principal = p - iTruck; truck += iTruck - p; }
    if (!sold && mtg > 0) { const p = Math.min(A.mortgagePmt, mtg + iMtg); req.mortgage = p; amort.mortgage[k].interest = iMtg; amort.mortgage[k].principal = p - iMtg; mtg += iMtg - p; }
    if (wf > 0 && cal < wfDue) { const p = Math.min(A.wfMin, wf); req.wf = p; amort.wf[k].principal = p; wf -= p; }
    if (usb > 0 && cal < usbDue) { const p = Math.min(A.usbMin, usb); req.usb = p; amort.usb[k].principal = p; usb -= p; }
    if (heloc > 0) { req.heloc = iHeloc; amort.heloc[k].interest = iHeloc; }
    for (const p of phases) if (p.bal > 0) { const ip = p.bal * S.phaseApr / 12; req['ph:' + p.id] = ip; amort['ph:' + p.id][k].interest = ip; }
    const reqTotal = Object.values(req).reduce((a, b) => a + b, 0);
    interestPaid += iTruck + iMtg + iHeloc + phases.reduce((a, p) => a + (p.bal > 0 ? p.bal * S.phaseApr / 12 : 0), 0);

    // Money in: rent, energy savings, then the paycheck covers the rest.
    const rent = sold ? 0 : I.income.rentalNet * infl, rent2 = !sold && cal >= rent2From ? I.income.rent2 * infl : 0;
    let save = 0; for (const p of phases) if (p.status !== 'pending' && p.saves) save += p.saves / 12 * esc;
    saved += save;
    const base = sold ? I.income.paycheckSold : I.income.paycheck;
    const pay = S.shortfall === 'paycheck' ? Math.max(base, reqTotal - rent - rent2 - save) : base;
    paycheckIn += pay;
    let surplus = rent + rent2 + save + pay - reqTotal;
    const fromBrok = Math.max(0, -surplus);
    Object.assign(row, { rent, rent2, save, paycheck: pay, req, reqTotal, fromBrok });

    // Lumps: cards at their 0% deadline, a sale on a date, gifts.
    for (const [key, due, name] of [['wf', wfDue, 'Wells Fargo card'], ['usb', usbDue, 'US Bank card']]) {
      const bal = key === 'wf' ? wf : usb;
      if (bal > 0 && cal >= due) {
        brok -= bal; amort[key][k].principal += bal;
        row.lumps.push({ what: `Pay off the ${name} from brokerage before its 0% ends`, amt: bal, from: 'brokerage', to: key });
        ev(t, 'card', `${name} paid off from brokerage`, bal);
        if (key === 'wf') wf = 0; else usb = 0;
      }
    }
    const value = A.rentalValue * (1 + R.appr) ** (t / 12);
    const sell = why => {
      const gross = value * (1 - R.commission), tax = R.capGains * Math.max(0, gross - R.basis) + R.recapture;
      let cash = gross - tax - mtg; amort.mortgage[k].principal += mtg; mtg = 0; sold = true;
      const toTruck = S.sell === 'onDate' ? Math.min(cash, truck) : 0; truck -= toTruck; cash -= toTruck; amort.truck[k].principal += toTruck;
      const toLine = S.sell === 'onDate' ? Math.min(cash, heloc) : 0; heloc -= toLine; cash -= toLine; amort.heloc[k].principal += toLine;
      brok += cash;
      row.lumps.push({ what: `Rental sold${why}: ${toTruck ? 'truck paid off, ' : ''}${toLine ? 'HELOC paid down, ' : ''}the rest to brokerage`, amt: gross - tax, from: 'sale' });
      ev(t, 'sale', 'Rental sold', gross - tax, { toTruck, toLine, tax, gross });
    };
    if (!sold && S.sell === 'onDate' && cal === sellOn) sell(' (on the date you set)');
    const target = () => (S.truckFirst && truck > 0.005 ? 'truck' : heloc > 0 ? 'heloc' : openPhase() ? 'ph:' + openPhase().id : null);
    const payDown = (key, amt) => {
      if (key === 'truck') { const p = Math.min(amt, truck); truck -= p; amort.truck[k].principal += p; return p; }
      if (key === 'heloc') { const p = Math.min(amt, heloc); heloc -= p; amort.heloc[k].principal += p; return p; }
      const ph = phases.find(q => 'ph:' + q.id === key); const p = Math.min(amt, ph.bal); ph.bal -= p; amort[key][k].principal += p; return p;
    };
    for (const g of gifts.filter(g => calOf(g.month) === cal)) {
      const keep = Math.min(g.amount, Math.max(g.keep, S.refillFloor ? S.floor - brok : 0, 0)); brok += keep;
      let left = g.amount - keep, to = [];
      while (left > 0.5 && target()) { const key = target(), p = payDown(key, left); left -= p; to.push([key, p]); if (!p) break; }
      brok += left;
      row.lumps.push({ what: `Gift: ${keep ? `$${Math.round(keep).toLocaleString('en-US')} to brokerage, ` : ''}${to.map(([key, p]) => `$${Math.round(p).toLocaleString('en-US')} to ${nameOf(key, phases)}`).join(', ')}${left > 0.5 ? `${to.length ? ', ' : ''}$${Math.round(left).toLocaleString('en-US')} to brokerage` : ''}`, amt: g.amount, from: 'gift' });
      ev(t, 'gift', 'Gift arrives', g.amount, { keep, to });
    }

    // Surplus waterfall: refill the floor, then the HELOC, then the open
    // phase line, then the mortgage once every phase is paid, then brokerage.
    if (surplus > 0 && S.refillFloor && brok < S.floor) { const p = Math.min(surplus, S.floor - brok); brok += p; surplus -= p; row.extra.brokerage = p; floorHits++; }
    if (surplus > 0 && S.truckFirst && truck > 0.005) { const p = payDown('truck', surplus); surplus -= p; row.extra.truck = p; }
    if (surplus > 0 && heloc > 0) { const p = payDown('heloc', surplus); surplus -= p; row.extra.heloc = p; }
    if (surplus > 0 && openPhase()) { const key = 'ph:' + openPhase().id, p = payDown(key, surplus); surplus -= p; row.extra[key] = p; }
    const allDone = phases.every(p => p.status === 'done');
    if (surplus > 0 && S.prepayMortgage && allDone && heloc <= 0 && !sold && mtg > 0) { const p = Math.min(surplus, mtg); mtg -= p; surplus -= p; amort.mortgage[k].principal += p; row.extra.mortgage = p; }
    if (surplus > 0) row.extra.brokerage = (row.extra.brokerage ?? 0) + surplus;
    brok += surplus;

    // Lines close and phases open.
    for (const p of phases) if (p.status === 'open' && p.bal <= 0.5) { p.status = 'done'; p.bal = 0; ev(t, 'close', `${p.name} line paid off`); }
    if (S.mode === 'separate') {
      if (heloc <= 0.5 && helocClosed == null) { heloc = 0; helocClosed = cal; ev(t, 'close', 'Renovation HELOC paid off: close it'); }
      if (helocClosed != null && !openPhase()) {
        const next = phases.find(p => p.status === 'pending');
        if (next) { next.status = 'open'; next.bal = next.amount; amort['ph:' + next.id][k].draw = next.amount; row.lumps.push({ what: `Take out a new ${pct(S.phaseApr)} HELOC and buy: ${next.name}`, amt: next.amount, from: 'new line' }); ev(t, 'open', `${next.name}: take out a new HELOC`, next.amount, { id: next.id }); }
      }
    } else {
      // Redraw: a phase draws on the HELOC once it has fallen to the trigger
      // and the limit allows.
      for (const next of phases.filter(p => p.status === 'pending')) {
        if (heloc > S.redrawAt || heloc + next.amount > A.helocLimit) break;
        heloc += next.amount; next.status = 'done'; amort.heloc[k].draw += next.amount;
        row.lumps.push({ what: `Draw the HELOC for: ${next.name}`, amt: next.amount, from: 'HELOC' });
        ev(t, 'open', `${next.name}: drawn on the HELOC`, next.amount, { id: next.id });
      }
      if (heloc <= 0.5 && phases.every(p => p.status === 'done') && helocClosed == null) { heloc = 0; helocClosed = cal; ev(t, 'close', 'HELOC paid off: close it'); }
    }

    // Workbook rule: brokerage pays a line off when it can keep the cushion.
    if (S.brokPayoff) {
      const key = target(), bal = key === 'truck' ? truck : key === 'heloc' ? heloc : key ? openPhase().bal : 0;
      if (key && brok >= bal + S.cushion) { brok -= bal; payDown(key, bal); row.lumps.push({ what: `Pay off ${nameOf(key, phases)} from brokerage`, amt: bal, from: 'brokerage' }); ev(t, 'brok', `Brokerage pays off ${nameOf(key, phases)}`, bal); }
    }

    // Sell once the mortgage is prepaid.
    if (!sold && S.sell === 'afterPayoff' && mtg <= 0.5 && phases.every(p => p.status === 'done') && heloc <= 0.5) sell(' (mortgage prepaid)');

    brok *= 1 + S.ret / 12;
    if (brok < minBrok.v) minBrok = { v: brok, cal };
    for (const [key] of DEBTS) amort[key][k].bal = { heloc, mortgage: mtg, truck, wf, usb }[key];
    for (const p of phases) amort['ph:' + p.id][k].bal = p.bal;
    const phaseBal = phases.reduce((a, p) => a + p.bal, 0);
    const debt = heloc + phaseBal + mtg + truck + wf + usb;
    Object.assign(row, { brok, heloc, phaseBal, phases: phases.map(p => ({ id: p.id, status: p.status, bal: p.bal })), mtg, truck, wf, usb, sold, value, debt, nw: brok + (sold ? 0 : value) - debt });
    rows.push(row);
  }

  const firstCal = f => rows.find(f)?.cal ?? null;
  const summary = {
    helocClosed, debtFree: firstCal(r => r.debt < 1),
    consumerFree: firstCal(r => r.truck + r.wf + r.usb < 1), truckFree: firstCal(r => r.truck < 1),
    phasesDone: firstCal(r => r.phases.every(p => p.status === 'done')),
    sold: events.find(e => e.kind === 'sale')?.cal ?? null,
    interestPaid, paycheckIn, saved, minBrok, floorHits,
    nwEnd: rows.at(-1).nw, nwNet: rows.at(-1).nw - paycheckIn,
  };
  return { inputs: I, n0, rows, events, amort, summary };
}

const pct = v => `${+(v * 100).toFixed(2)}%`;
export function nameOf(key, phases) {
  if (key === 'heloc') return 'the HELOC';
  if (key === 'truck') return 'the truck';
  const p = phases.find(q => 'ph:' + q.id === key);
  return p ? `the ${p.name.split(':')[0].toLowerCase()} line` : key;
}

// The inputs a check-in at `cal` would start from if everything went to plan.
export function projectInputs(sim, cal) {
  const r = sim.rows.find(x => x.cal === cal);
  if (!r) return null;
  const I = clone(sim.inputs);
  I.asOf = ymOf(cal); I.note = '';
  Object.assign(I.accounts, { brokerage: round2(r.brok), heloc: round2(r.heloc), mortgage: round2(r.mtg), truck: round2(r.truck), wf: round2(r.wf), usb: round2(r.usb), rentalValue: Math.round(r.value), rentalSold: r.sold });
  I.phases = I.phases.map(p => { const q = r.phases.find(x => x.id === p.id); return { ...p, status: q.status, bal: round2(q.bal) }; });
  const yrs = (cal - sim.n0) / 12;
  I.income.rentalNet = round2(I.income.rentalNet * (1 + I.income.inflation) ** yrs);
  I.income.rent2 = round2(I.income.rent2 * (1 + I.income.inflation) ** yrs);
  for (const p of I.phases) if (p.saves) p.saves = Math.round(p.saves * (1 + I.escalation) ** yrs);
  return I;
}
const round2 = v => Math.round(v * 100) / 100;

// A small copy of the projection to keep with a check-in: quarter-end
// balances, and the headline dates.
export function seriesOf(sim) {
  return {
    points: sim.rows.filter(r => r.t % 3 === 0 || r.t === 1).map(r => ({ cal: r.cal, debt: Math.round(r.debt), heloc: Math.round(r.heloc), phases: Math.round(r.phaseBal), mtg: Math.round(r.mtg), brok: Math.round(r.brok), nw: Math.round(r.nw) })),
    summary: { helocClosed: sim.summary.helocClosed, debtFree: sim.summary.debtFree, nwEnd: Math.round(sim.summary.nwEnd) },
  };
}

// Other ways from the same starting point.
export function variants(inp) {
  const v = (label, f) => { const I = clone(inp); f(I); const s = simulate(I); return { label, s: s.summary, end: s.rows.at(-1).cal }; };
  return [
    v('As entered', () => {}),
    ...(inp.strategy.sell === 'onDate'
      ? [v('Keep the rental; sell once its mortgage is prepaid (workbook)', I => { I.strategy.sell = 'afterPayoff'; }), v('Keep the rental for good', I => { I.strategy.sell = 'never'; })]
      : [v('Sell the rental next month, equity to the truck and HELOC', I => { I.strategy.sell = 'onDate'; I.strategy.sellOn = ymOf(calOf(I.asOf) + 1); }), v('Keep the rental for good', I => { I.strategy.sell = 'never'; })]),
    v('Phases redraw the HELOC at $100k instead (workbook)', I => { I.strategy.mode = 'redraw'; }),
    v('Brokerage pays a line off when it can keep $50k', I => { I.strategy.brokPayoff = true; }),
    v(inp.strategy.truckFirst ? 'Gifts and surplus to the HELOC before the truck' : 'Gifts and surplus pay off the truck first', I => { I.strategy.truckFirst = !I.strategy.truckFirst; }),
    v('$250/mo more from the paycheck', I => { I.income.paycheck += 250; I.income.paycheckSold += 250; }),
  ];
}
