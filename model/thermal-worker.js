// Runs the heating and cooling model off the main thread for thermal.html.
import { runModel, slimResult, prepareWeather } from './thermal.js';

let wxRaw = null, prepared = null;

self.onmessage = async ({ data }) => {
  try {
    if (!wxRaw) {
      const res = await fetch(new URL('../data/casper-tmy3.json', import.meta.url));
      wxRaw = await res.json();
      prepared = prepareWeather(wxRaw);
    }
    const r = runModel(wxRaw, data.inputs, undefined, { prepared });
    self.postMessage({ id: data.id, result: slimResult(r) });
  } catch (err) {
    self.postMessage({ id: data.id, error: String((err && err.message) || err) });
  }
};
