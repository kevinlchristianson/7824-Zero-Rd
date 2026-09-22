// Runs the heating and cooling model off the main thread for thermal.html.
// Posts the main result first, then the sensitivity rows as they finish; a
// newer request cancels an unfinished sensitivity pass.
import { runModel, slimResult, prepareWeather, SENSITIVITY, sensitivityCase } from './thermal.js';

let wxRaw = null, prepared = null, latest = 0;
const tick = () => new Promise(r => setTimeout(r, 0));

self.onmessage = async ({ data }) => {
  latest = data.id;
  try {
    if (!wxRaw) {
      const res = await fetch(new URL('../data/casper-tmy3.json', import.meta.url));
      wxRaw = await res.json();
      prepared = prepareWeather(wxRaw);
    }
    if (latest !== data.id) return;
    const r = runModel(wxRaw, data.inputs, undefined, { prepared });
    self.postMessage({ id: data.id, result: slimResult(r) });

    const rows = [];
    for (const c of SENSITIVITY) {
      const row = { key: c.key, label: c.label };
      for (const which of ['better', 'worse']) {
        await tick();
        if (latest !== data.id) return;
        row[which] = sensitivityCase(c, which, r);
      }
      rows.push(row);
    }
    self.postMessage({ id: data.id, sensitivity: { base: r.cost.totals.total, rows } });
  } catch (err) {
    self.postMessage({ id: data.id, error: String((err && err.message) || err) });
  }
};
