// Runs the solar plan off the main thread for solar.html.
import { solarPlan } from './solar.js';
import { prepareWeather, INPUTS as THERMAL } from './thermal.js';

let wxRaw = null, prepared = null, latest = 0;
self.onmessage = async ({ data }) => {
  latest = data.id;
  try {
    if (!wxRaw) {
      wxRaw = await (await fetch(new URL('../data/casper-tmy3.json', import.meta.url))).json();
      prepared = prepareWeather(wxRaw);
    }
    if (latest !== data.id) return;
    self.postMessage({ id: data.id, plan: solarPlan(wxRaw, data.inputs, THERMAL, prepared) });
  } catch (err) {
    self.postMessage({ id: data.id, error: String((err && err.message) || err) });
  }
};
