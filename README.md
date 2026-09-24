# 7824 Zero Rd

Models of the U-shaped brick building at 7824 Zero Rd, Casper, WY, built on one set of geometry.

- **`index.html`**: parametric three.js massing model (3D viewer), with solar panels laid out on the south roof slopes. `npm run roofpv` rebuilds the layout in `data/roofpv.json`.
- **`wiring.html`**: DC wiring for the shop's roof array: strings, home runs, the roof junction box, conduits to the inverters in the shop's SE corner, grounding, and the wire and parts list. `npm run roofpv` rebuilds `data/wiring.json` with the layout.
- **`thermal.html`**: hourly heating & cooling model on the Casper TMY3 weather year, with Wyoming wind driving air leakage. It forecasts the renovated building and shows this winter's as-is building beside it, estimates what the gas and electric bills will say month by month, and fits the center's airtightness to Black Hills bills. Inputs are editable and the page reruns the model in a web worker.
- **`solar.html`**: solar, heat pump and net-metering plan. It shows what to buy first, what to add later, and what never pays.
- **`offgrid.html`**: off-grid questions sized hour by hour, in grid-down conservation mode: (A) batteries, generator and stored gas to carry the grid-tied house through its worst week; (B) full off grid with no gas on heat pumps, resistance and batteries; (C) the same with an outdoor wood boiler. `npm run offgrid` rebuilds `data/offgrid.json`.
- **`finance.html`**: the financial model. Every account's balance as of the last check-in, run forward month by month (`model/finance.js`): what to pay this month, the steps and cash-flow triggers ahead, each loan's amortization, and other paths from the same balances. Inputs are live-editable and autosave to the page's database; each check-in is filed with the plan it makes, so later check-ins show ahead or behind. `npm run finance` prints the default plan and writes `data/finance-seed.json`, the first check-in.

All three read `model/params.js`: the plan dimensions, heights and the full door/window inventory.

## The building

- **Center block**: two stories. The wall stack is 11′ ground level, then a 2′ floor structure, then a 9′ upper level. A 10′-deep porch with six arches stands outside it on the courtyard side, with an open deck on top along the upper level, and an exterior steel stair climbs the east face.
- **North leg (shop)**: one tall volume. It has the center block's footprint turned 90°, plus a vestibule across its west end behind four arches.
- **South leg**: one tall volume (garage), with overhead doors onto the south drive. Unheated.
- Gable roofs throughout (owner). The ridges are assumed to run the long way: north–south on the center, east–west on the legs.

The center block and the shop are 48′ × 68′ inside (owner), with about 16″ of brick and foam; the buildings are rectangles butted together (the overlap seen from above is the eaves). Positions are scaled from Google Earth. The ruler reads 82.33 ft along the north leg's north roof edge, about 0.328 ft/px. The upper-level openings come from the owner: sixteen 41″ × 67″ windows, a 36″ door and a 72″ door. Everything else not listed under *Heating & cooling model* is estimated from the listing photos.

## Heating & cooling model (`model/thermal.js`)

- **Zones:** shop, center ground level, center upper level, and south leg (unheated). The vestibule in front of the shop is cosmetic and not modeled. Each zone has an air node and a thermal-mass node, and the model steps every 15 minutes through all 8,760 hours.
- **Given by the owner:**
  - Shop: 12″ brick with R-15 closed-cell foam, R-40 attic. Held at 45°F minimum, and 70°F for about 12 h/week on heating-degree days.
  - Ground level: R-30 walls, R-20 ceiling to the upper level. Held at 60°F minimum, and 70°F for 28 h/week on heating-degree days.
  - Upper level: R-30 walls, R-60 roof. Held at 68°F year round, with 40 evenly spaced empty days at a 55°F minimum.
  - Every wall has at least 1″ of closed-cell foam except the south leg's.
- **Weather:** Casper Natrona Co Intl AP TMY3 (WMO 725690), from the EnergyPlus weather library, stored in `data/`. The design points are ASHRAE 2009 values: −10.3°F heating with a coincident 8.5 mph wind, and 93.7°F cooling.
- **Wind:** air leakage follows the LBL stack + wind model on hourly wind, using blower-door ACH50 inputs. Outside surface films vary with the wind and with windward or leeward exposure.
- **Also modeled:**
  - sol-air on walls and doors
  - vented-attic heating
  - window solar gain with overhang shading
  - slab-edge F-factor losses
  - heat flow between zones through the shared walls and the R-20 floor
  - heaters sized at 1.4× each zone's design load, so warm-ups take realistic time
- **Openings (owner):**
  - Shop: no windows and no doors on the windward side; it is super airtight (modeled at ACH50 1.5). It is heated to 70°F two 6-hour days a week.
  - Ground level: no windows. A 36″ walkout to the courtyard, and 86″ walkthroughs into the shop and the south leg.
- **Equipment (owner):**
  - A Navien condensing combi-boiler heats, at an assumed 88% seasonal efficiency.
  - An MBTEK Apollo 3.5-ton air-to-water heat pump cools at COP 4.6.
  - Both run through an MBTEK AP-AHU-6T air handler drawing 460 W. It runs for heat delivered ÷ its output, and for cooling ÷ the Apollo's capacity.
- **Rates (owner's Aug-2026 bills, rates only; checked against the September 2026 Black Hills bill, which puts Zero Rd on residential RGS GCA with a $33.00 customer charge and no franchise fee):**
  - Gas: $0.576/therm all-in, on Black Hills Energy RGS GCA.
  - Electric: $0.1017/kWh all-in, on Rocky Mountain Power Schedule 25 (Small General Service, which is what the Zero Rd account is on; the owner's other two premises are on Residential Schedule 2, which would be $0.1209/kWh with a $24.88 basic charge and is dearer above 654 kWh a month).
  - Monthly service charges ($34.65 gas, $37.46 electric) are reported separately.
- **Center airtightness is unknown.** The model runs a best guess (ACH50 5) plus a tight (3) to leaky (8) range, and reports costs for all three.
- **The headline is the renovated building.** Owner: the R-30 walls, R-60 roof, continuous foam and new windows are what the two renovation phases will deliver, not what stands today. The page runs the same year for **this winter's building** beside it: the center block with the 1″ of closed-cell foam every wall already carries (R-7), an R-19 attic, older U-0.8 windows and ACH50 12 (8–18 as its range), at the same setpoints on the same equipment. A switch marks the upper level done after reno phase 1, leaving only the ground level as-is. The shop is as given in both. At the defaults the renovated building costs about $1,800 a year to heat and cool and the as-is one about $3,450.
- **What the bills will say.** Month by month, gas and electric at the rates and customer charges above, for the renovated building and this winter's: the model's heating and cooling plus the *Household* inputs, 47 kWh a day of household electricity (the solar plan's figure; Palmer Dr measured 33 over the year to July 2026) and 18 therms a month for hot water and cooking (Palmer Dr's summer floor). At the defaults the renovated building bills about $375 a month and the as-is one about $510.
- **Calibrate to your bills.** Billed therms entered by month, less the *Household* hot water and cooking figure, are fitted to the year simulated at eight airtightness values (ACH50 2–20) for whichever state the bills came from: as-is, after phase 1, or renovated. The page reports the implied ACH50, modeled against billed therms, and the year's cost at that fit. TMY3 is a typical year, so a single month can miss by a fifth on weather alone.
- **Assumptions to confirm** (tagged *assumed* in the page):
  - center airtightness
  - slab-edge insulation
  - boiler efficiency
  - the AHU's heat output
  - window U-factor and SHGC
  - internal gains
  - the as-is shell: its foam, attic, windows and airtightness before the renovation

## Solar plan (`model/solar.js`)

The plan runs hourly over the same TMY3 year:

- **PV output.** Isotropic sky on a south-facing array tilted 40°. Faiman cell temperature. Each EG4 18kPV clips at 12 kW AC and takes up to 18 kW DC.
- **Loads.** Heating and cooling come from the thermal model. Household electricity is 47 kWh/day. Hot water is 60 gal/day at 120°F. The plan's own assumptions differ from the thermal page in three places: the Navien at 93% (thermal page: 88%), the upper level's internal gains taken from the 47 kWh/day (thermal page: 0.2 W/ft²), and the shop heated by the existing Modine at 82% (thermal page: the Navien through the AHU).
- **Heat pump setups.** No Apollo is bought yet. The plan compares one 3.5-ton, one 6-ton, 3.5 + 6, and two 6-tons, each on the existing 6-ton AHU or with a second 3.5-ton AHU. It follows the owner's hydronic pack. The heat pump charges a 250-gal buffer on an outdoor reset, 85 to 120 °F. The buffer feeds the upstairs radiant floor (capacity-limited at tank temperature), the AHU and the shop unit heater, and it preheats the Navien combi's cold water. There are three heating modes. Cool-only leaves heat to the Navien. Heat-first runs the heat pump whenever it can. Smart spends solar credit that would otherwise be paid out at the true-up on the best-COP hours. Each setup gets its cheapest array and is ranked by 25-year cost.
- **Net metering.** Rocky Mountain Power's Wyoming rules: kWh netted monthly, surplus banked at retail, leftover credit paid at avoided cost at the annual true-up, 25 kW AC cap.

- **Inverters.** A catalog of options, each with its own AC and DC limits, efficiency, standby draw and price: EG4 18kPV, FlexBOSS21, FlexBOSS18 and 12kPV; SolarEdge SE11400H; SMA Sunny Boy 7.7; Enphase IQ8HC. Each one gets its own purchase order, and `pv.inverter: 'auto'` plans around whichever is worth the most.

A greedy "ladder" adds the upgrade with the shortest payback at each step: panels, a second inverter, the heat pump, or a battery. It stops when the next step's net present value is negative.

Costs and rates come from `Casper_Solar_Sizing_Model.xlsx`. Inputs the owner still needs to confirm are marked ASSUMED on the page.

```sh
npm install
npm run serve                   # http://localhost:8080/ (3D) and /thermal.html
npm run thermal                 # print the model report
npm run thermal:write           # refresh data/thermal-defaults.json for the page
npm run solar                   # print the solar plan report
npm run solar:write             # refresh data/solar-defaults.json for the page
npm run roofpv                  # lay out panels on the south roofs; writes data/roofpv.json
npm run weather                 # rebuild data/casper-tmy3.json from the EPW
npm run export                  # export/7824-zero-rd.{obj,mtl,glb}
node scripts/export.mjs --no-context   # building only, no ground
```

OBJ files are in feet (+X east, +Y up, +Z south). GLB files are in metres.
