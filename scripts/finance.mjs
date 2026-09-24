// Prints the financial model from its default inputs (the workbook's June
// 2026 balances) and writes data/finance-seed.json: the baseline check-in the
// page's history starts from. Usage: npm run finance
import { writeFileSync } from 'node:fs';
import { simulate, FIN_INPUTS, seriesOf, variants, labelOf } from '../model/finance.js';

const $ = v => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
const L = c => (c == null ? '—' : labelOf(c));
const t0 = performance.now();
const sim = simulate(FIN_INPUTS), S = sim.summary;
console.log(`As of ${L(sim.n0)}: HELOC closed ${L(S.helocClosed)}, consumer debt gone ${L(S.consumerFree)}, all debt gone ${L(S.debtFree)}, rental sold ${L(S.sold)}`);
console.log(`Interest ${$(S.interestPaid)}, bills saved ${$(S.saved)}, paycheck ${$(S.paycheckIn)}, lowest brokerage ${$(S.minBrok.v)} (${L(S.minBrok.cal)}), net worth ${$(S.nwEnd)} (${$(S.nwNet)} net of paycheck)`);
console.log(`Gifts kept in brokerage: ${sim.inputs.gifts.map(g => `${g.month} ${$(g.keep)}`).join(', ')}`);
for (const e of sim.events) console.log(`  ${L(e.cal).padEnd(9)} ${e.what}${e.amt ? ' ' + $(e.amt) : ''}`);
console.log('Other paths:');
for (const v of variants(FIN_INPUTS)) console.log(`  ${v.label.padEnd(58)} HELOC ${L(v.s.helocClosed).padEnd(9)} debt-free ${L(v.s.debtFree).padEnd(9)} net of paycheck ${$(v.s.nwNet)}`);
console.log(`(${Math.round(performance.now() - t0)} ms)`);

// The first check-in: the workbook's balances and the plan they make.
const seed = { asOf: FIN_INPUTS.asOf, note: FIN_INPUTS.note, savedAt: new Date().toISOString(), inputs: FIN_INPUTS, ...seriesOf(sim) };
writeFileSync(new URL('../data/finance-seed.json', import.meta.url), JSON.stringify(seed));
console.log('wrote data/finance-seed.json');
