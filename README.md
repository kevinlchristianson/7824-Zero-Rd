# 7824 Zero Rd — massing model

A parametric three.js model of the U-shaped brick building at 7824 Zero Rd.

- **Center block**: two stories. Wall stack is 11′ ground level + 2′ floor structure + 9′ upper level = 22′ plate. A 6-arch loggia faces the courtyard, and an exterior steel stair climbs the east face.
- **North leg**: one tall volume. It has the center block's footprint turned 90°, plus a vestibule across the west end behind four arches.
- **South leg**: one tall volume (garage), with overhead doors onto the south drive.
- Hip roofs throughout.

Plan dimensions are scaled from Google Earth. The ruler reads 82.33 ft along the north leg's north roof edge, about 0.328 ft/px. Leg wall heights, roof pitch and opening placement are estimated from the listing photos. All inputs are in `model/building.js` (`DEFAULTS`).

## Use

```sh
npm install
npm run serve          # open http://localhost:8080 for the 3D viewer
npm run export         # writes export/7824-zero-rd.{obj,mtl,glb}
node scripts/export.mjs --no-context   # building only, no ground/trees
```

OBJ files are in feet (+X east, +Y up, +Z south). GLB files are in metres.
