# Data licenses and attribution

The OpenStreetMap-derived city database is made available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). **© OpenStreetMap contributors.** See [OpenStreetMap's copyright and attribution requirements](https://www.openstreetmap.org/copyright). The original OSM extract and the derived road/building graph are included so recipients can inspect and rebuild the database. The game's source code license is separate from this data license.

Elevation is sourced from the [USGS National Map 3D Elevation Program (3DEP) bare-earth DEM service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer). USGS-authored data are public domain; retain USGS credit and the accompanying source metadata. The service is a multi-resolution mosaic; 3.90625 m is the exported sample spacing, not a claim that all contributing measurements were acquired at that resolution. [USGS copyright and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits).

Each city directory includes `sources/manifest.json` with retrieval timestamps and SHA-256 checksums. The exported terrain uses real elevations without invented fallback heights. Procedural façade styles and default height estimates are declared in the package; they are not claimed to be surveyed building appearance.
