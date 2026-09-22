# 7824 Zero Rd

Two models of the U-shaped brick building at 7824 Zero Rd, Casper, WY, built on one set of geometry.

- **`index.html`**: parametric three.js massing model (3D viewer).
- **`thermal.html`**: hourly heating & cooling model on the Casper TMY3 weather year, with Wyoming wind driving air leakage. Inputs are editable and the page reruns the model in a web worker.

Both read `model/params.js`: the plan dimensions, heights and the full door/window inventory.

## The building

- **Center block**: two stories. The wall stack is 11′ ground level, then a 2′ floor structure, then a 9′ upper level. A 6-arch loggia faces the courtyard, and an exterior steel stair climbs the east face.
- **North leg (shop)**: one tall volume. It has the center block's footprint turned 90°, plus a vestibule across its west end behind four arches.
- **South leg**: one tall volume (garage), with overhead doors onto the south drive. Unheated.
- Hip roofs throughout.

Plan dimensions are scaled from Google Earth. The ruler reads 82.33 ft along the north leg's north roof edge, about 0.328 ft/px. The upper-level openings come from the owner: sixteen 41″ × 67″ windows, a 36″ door and a 72″ door. Everything else not listed under *Heating & cooling model* is estimated from the listing photos.

## Heating & cooling model (`model/thermal.js`)

- **Zones:** shop, vestibule (unheated buffer), center ground level, center upper level, and south leg (unheated). Each zone has an air node and a thermal-mass node, and the model steps every 15 minutes through all 8,760 hours.
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
- **Assumptions to confirm** (tagged *assumed* in the page):
  - airtightness
  - slab-edge insulation
  - window U-factor and SHGC
  - the ground-level and shop openings
  - internal gains
  - rates and equipment

```sh
npm install
npm run serve                   # http://localhost:8080/ (3D) and /thermal.html
npm run thermal                 # print the model report
npm run thermal:write           # refresh data/thermal-defaults.json for the page
npm run weather                 # rebuild data/casper-tmy3.json from the EPW
npm run export                  # export/7824-zero-rd.{obj,mtl,glb}
node scripts/export.mjs --no-context   # building only, no ground/trees
```

OBJ files are in feet (+X east, +Y up, +Z south). GLB files are in metres.
