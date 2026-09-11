# City Wheels

**[Play the browser prototype](https://aryans313.github.io/city-wheels/)** · [Unreal source](unreal/) · [Data pipeline](pipeline/README.md) · [Architecture](docs/architecture.md) · [Expansion roadmap](docs/roadmap.md)

Drive a real **1 km × 1 km** slice of Russian Hill, San Francisco, including crooked Lombard Street and steep Filbert Street. This repository contains a UE5 C++ starter, a reproducible OpenStreetMap/USGS import pipeline, and a public playable browser companion.

**Status (v0.3):** the browser prototype has a detailed licensed car, 40 moving vehicles (including four police patrols), 16 parked cars, 150 residents, business scenery, police pursuit and car theft. The Unreal source is not yet compiled or packaged: the authoring machine has no Unreal Engine or full Xcode installation. This is the first district prototype, not the complete photorealistic game. The browser edition uses Three.js and cannon-es; it does not use Unreal, Lumen or Nanite.

## Play

Open **https://aryans313.github.io/city-wheels/** on a desktop browser and select **Take the wheel**. Touch driving controls are available on touch devices.

- **WASD / arrows:** drive; S brakes before reversing.
- **Space:** handbrake. **R:** recover to the road and repair when not wanted.
- **Hold E:** steal a nearby slow or parked car; both cars must be within 7 m and below 12 km/h. A touch interaction button appears when a target is in reach.
- **C:** chase, cockpit and cinematic cameras. **H:** horn. Engine, skid and impact audio starts when you play; toggle sound in the top bar.
- **P:** photo mode; drag to orbit, scroll to zoom, save a screenshot.
- **Esc:** pause/resume. Press a driving key or click the scene to resume after switching tabs.
- Use the weather controls for daylight, bay fog, rain and night.
- Select **Start a delivery**, follow the amber marker on the minimap, and stop nearby.

The browser car uses a 1,450 kg rigid body, four suspension contacts, engine torque/gearing and surface-dependent grip. The detailed CC BY 4.0 CarConcept body includes an interior, separate wheels and PBR materials. Impacts transfer momentum, deform local panels, add scratches and crack the windshield. Major front damage reduces power; small scrapes preserve driveability. Recovery repairs the car.

The fleet covers the district with 40 moving cars, including four police units, plus 16 physical parked cars. Car profiles have different mass, power and grip; taking a car preserves its existing condition and tune. All vehicles currently share the same licensed body geometry with different paint and police details.

150 residents occupy all 25 sections of the playable 1 km² district. People walk, chat, drink coffee, dine outside and rest with personal belongings. The 38 decorated venues include nine cafés, ten restaurants, nine hotels and ten homes, plus five quiet rest pockets. Existing OSM-tagged names are distinguished from fictional scenery; doors, menus, seating and residents are game additions rather than a current business directory.

The 792 trees, lamps and bollards and 126 business/rest fixtures share placement with solid colliders. Buildings retain concave openings and courtyards. The continuous road-conforming heightfield avoids the previous overlapping road-box faces that caused abrupt stops.

Minor pedestrian impacts can cause a recoverable stumble. More severe impacts can leave a person injured or dead, with persistent non-graphic outcomes until restart. These are fictional game rules, not a medical injury model. Everyone uses the same collision rules.

Player-caused serious injury, a fatal collision, or car theft alerts the police. Patrol cars pursue with physical steering, engine and brake forces. Hide from their line of sight for **60 continuous seconds** to clear the wanted level; being spotted resets the timer. Remaining within 6.5 m of a seeing officer at low speed for three seconds leads to **BUSTED** and a **Start again** button (Enter also restarts). Recovery cannot clear an active pursuit.

Traffic is still a prototype: full signal phases, lane merging and complex traffic-law compliance are unfinished. Pedestrians are stylized, with rigid-body toppling rather than skeletal ragdolls; they follow sidewalks and activity anchors. Theft is a nearby vehicle takeover with an exited-driver reaction, without an on-foot player mode or animated door entry. Furniture stays anchored. This remains a browser prototype, not a GTA-level city or soft-body crash simulator.

## Real city data

The checked-in tile uses EPSG:32610 and a 257 × 257 USGS 3DEP grid, sampled at 3.90625 m spacing. It contains 264 road polylines and 1,925 building footprints. The terrain ranges from 3.48 to 109.90 m. 1,548 buildings have explicit OSM height tags; the remaining estimates are labeled. OSM source geometry, one-way travel, turn restrictions, surface tags, cable-car rail lines and source identifiers are retained.

Raw OSM XML, the float32 elevation GeoTIFF, service metadata, retrieval dates and SHA-256 hashes are included for reproducibility. Missing data is not replaced with fabricated hills. See [pipeline documentation](pipeline/README.md) and [tile summary](data/cities/san-francisco/summary.json).

Golden Gate Bridge, Coit Tower, Pier 39 and Transamerica Pyramid have real coordinate records but lie outside this first tile. Bradford Street is also outside it. They have not been moved into Russian Hill or represented as completed imported landmarks.

## Unreal Engine 5

Open [unreal/](unreal/) for the C++ module, Blueprint-exposed vehicle tuning, custom suspension/tire forces, generic procedural city importer, Lumen renderer settings, and editor bootstrap/build scripts. The bootstrap creates Blueprint assets and the playable map on a machine with UE installed. Engine files and proprietary assets are not included.

A native packaged executable must be built and play-tested with an Unreal toolchain. Source inspection and browser tests do not establish that the UE target compiles or meets visual/performance requirements. See [native build instructions](unreal/README.md).

## Run and verify locally

```sh
npm ci --prefix web
npm test --prefix web
npm run build --prefix web
npm run dev --prefix web
```

The build copies the shared city package into the public browser output. To rebuild geographic data or run importer fidelity checks, follow [pipeline/README.md](pipeline/README.md). No network is needed to rebuild from the included source files once Python dependencies are installed.

Publish the browser build with `scripts/publish-pages.sh`. GitHub Pages serves the `gh-pages` branch. Native release packaging is a separate Unreal build operation.

## Scope still to build

Working mirrors, on-foot movement, animated car entry, multiple authored car classes, photorealistic facade and character kits, Nanite baking, landmark models, full signal/merge traffic, pedestrian road crossings, cyclists/cable cars/animals, taxi/race/getaway mission systems, branching story and garage economy are future milestones. [The roadmap](docs/roadmap.md) defines those stages and their acceptance gates.

## Attribution

© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Elevation from [USGS 3DEP](https://www.usgs.gov/3d-elevation-program). Original code is MIT; geographic data is separately licensed. Vehicle model: CarConcept by Eric Chadwick / Darmstadt Graphics Group, CC BY 4.0, adapted; see [asset credits](web/public/assets/car/ATTRIBUTION.md). See [NOTICE](NOTICE) and [LICENSE](LICENSE).
