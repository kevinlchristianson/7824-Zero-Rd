// Runs the heating and cooling model off the main thread for thermal.html.
// Posts the main result first, then the sensitivity rows as they finish, then
// the bill-calibration grid for the building state the page asked for; a
// newer request cancels an unfinished pass. A `calibOnly` request with the
// same inputs recomputes just the grid, for a new building state.
import { runModel, slimResult, prepareWeather, SENSITIVITY, sensitivityCase, calibrationGrid } from './thermal.js';

let wxRaw = null, prepared = null, latest = 0, last = null, calibState = 'asis';
const tick = () => new Promise(r => setTimeout(r, 0));

self.onmessage = async ({ data }) => {
  latest = data.id;
  if (data.calibState) calibState = data.calibState;
  try {
    if (!wxRaw) {
      const res = await fetch(new URL('../data/casper-tmy3.json', import.meta.url));
      wxRaw = await res.json();
      prepared = prepareWeather(wxRaw);
    }
    if (latest !== data.id) return;
    // Household figures only feed the page's bill arithmetic, so they don't make a new run.
    const key = JSON.stringify({ ...data.inputs, household: undefined });
    if (data.calibOnly && last && last.key === key) {
      const state = calibState;
      self.postMessage({ id: data.id, calib: { state, rows: calibrationGrid(last.r, state) } });
      return;
    }
    const r = runModel(wxRaw, data.inputs, undefined, { prepared });
    last = { key, r };
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

    await tick();
    if (latest !== data.id) return;
    const state = calibState;
    self.postMessage({ id: data.id, calib: { state, rows: calibrationGrid(r, state) } });
  } catch (err) {
    self.postMessage({ id: data.id, error: String((err && err.message) || err) });
  }
};
