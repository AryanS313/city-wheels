# City data compiler

The data compiler is independent of Unreal and the browser preview. It produces one metric city package from real OpenStreetMap geometry and USGS 3DEP bare-earth elevations. The checked-in San Francisco tile is **exactly 1,000 × 1,000 metres in UTM zone 10N**, centered on 37.8024° N, 122.4169° W. It includes Russian Hill, the crooked section of Lombard Street, and the steep part of Filbert Street. Bradford Street and four of the requested landmarks are outside this first tile.

## Run

```sh
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
# Rebuild entirely offline from checked-in, checksum-verified original sources:
.venv/bin/python pipeline/build_city.py --config pipeline/configs/san-francisco.json --output data/cities/san-francisco
# Refresh original sources, then compile:
.venv/bin/python pipeline/build_city.py --config pipeline/configs/san-francisco.json --output data/cities/san-francisco --download
# Source fidelity, road direction, terrain orientation, clipping, and importer tests:
.venv/bin/python -m unittest discover -s tests -p 'test_pipeline.py' -v
```

For another city, copy the JSON configuration, set its origin, projected CRS, styles, landmark references, and data endpoint, then run the same compiler into a new city directory. USGS 3DEP covers the United States; a non-US city needs a real compatible elevation source, not a change to vehicle or mission logic. The compiler refuses missing/flat elevation instead of substituting fabricated hills. Large areas should be processed as adjoining tiles or fed from a regional OSM PBF extract; the official OSM map API is intended for small bounds.

## Import stages

1. Project the configured latitude/longitude with `pyproj`, query a 100 m buffer around the tile, and retain the original OSM response compressed with SHA-256 and retrieval timestamp. The official OSM API is preferred; Overpass is a live fallback.
2. Request a **float32, single-band elevation TIFF**, using USGS `exportImage` and `rasterFunction: None`. A half-cell apron aligns source pixel centers with the 257 terrain vertices in each axis. Request bilinear interpolation and projected EPSG coordinates. Preserve the TIFF, image export metadata, service metadata, and intersecting source catalog.
3. Validate CRS, grid, no-data, and checksums. Flip north-first TIFF rows into the package's south-first vertex grid. Bilinearly sample that same surface for every road/building position. Heights are metres in the source orthometric vertical datum; the USGS catalog identifies NAVD 88 for this region.
4. Filter to motorcar-accessible road classes. Preserve actual OSM way order and `oneway=-1/0/1`, source IDs, surface, lanes, width, maxspeed, layer, bridge/tunnel flags, and tags. Clip to the exact square, preserve original vertices, and add samples at intervals no longer than 5 m. Footpaths, steps, pedestrian streets, and cycleways are excluded from drivable roads.
5. Produce legal directed edges through original OSM nodes, with virtual endpoints only at the tile boundary. Preserve turn-restriction relations, including conditional tags and a flag identifying references outside this tile. Consumers apply restrictions when routing. Intersections are based on OSM shared nodes, preventing accidental joins across grade-separated roads.
6. Stitch split/reversed building multipolygon members, subtract courtyards, and clip footprints. Explicit `height` wins; tagged levels use 3.1 m per level; missing values use a configured default. Every output height states its source. Facades use declared neighborhood palettes and are explicitly procedural, not photographic matches.
7. Fetch each landmark's exact OSM node or full footprint by configured OSM ID. Use the source node directly or its projected footprint centroid; the package states which method applies and links the original feature. Save the city package plus a readable summary. Landmarks beyond the tile remain geographic metadata with null elevation and are not rendered as if imported.

## Consumer contract

`schemaVersion: 1`; coordinates are metres: **X east, Y north, Z orthometric height**. Terrain is a flat row-major array, rows **south to north**, columns west to east. Vertex `(column,row)` is `(-500+column*cellSize, -500+row*cellSize, heights[row*width+column])` for this tile. The package includes the exact projected easting/northing origin.

Road `points` retain the OSM direction. `nodeIds` is parallel to those resampled points: actual OSM node IDs are strings, interpolated points are null. `sourceNodeIds` is the full original way; `osmWayId` is numeric. Graph edge endpoints reference `graph.nodes[].id`, and edges already follow legal one-way travel. A reverse one-way has points in original OSM order but graph edges reversed. Do not infer allowed directions from a road name.

Building rings omit the repeated closing vertex; `footprintHoles` preserves courtyards. Height means above-ground building height, not roof altitude. Ground footprints have individual sampled Z values; consumers should use a level roof and extend walls down to uneven foundations. Bridge/tunnel decks require authored or independently sourced profiles before broader expansion: a bare-earth DEM cannot determine deck clearance. The tile itself has no imported drivable bridge decks.

Spawn heading is radians clockwise from north: `0=north`, `+pi/2=east`. Position lies in a right-hand driving lane and Z is ground elevation; consumers add the vehicle's suspension/body spawn offset.

The data source does not contain complete signal phase timing, lane-level intersection turn geometry, parking behavior, traffic schedules, photographic materials, or landmark meshes. Those are game systems/art content, not verified map facts.
