#!/usr/bin/env python3
"""Compile OSM + USGS bare-earth elevations into a city-agnostic metric package.

Coordinates: local UTM, X east, Y north, Z metres above source vertical datum.
No geocentric engine values or engine code are stored in the city package.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import gzip
import json
import math
from pathlib import Path
import re
import sys

import numpy as np
from pyproj import Transformer
import rasterio
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union

try:
    from .fetch_sources import fetch, read_osm, parse_osm_xml
except ImportError:
    from fetch_sources import fetch, read_osm, parse_osm_xml

DRIVABLE = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service"}


def oneway_direction(tags):
    value = str(tags.get("oneway", "")).lower()
    if value == "-1":
        return -1
    if value in {"yes", "1", "true"}:
        return 1
    if value in {"no", "0", "false"}:
        return 0
    return 1 if tags.get("junction") == "roundabout" or tags.get("highway") in {"motorway", "motorway_link"} else 0


def drivable(tags):
    if tags.get("highway") not in DRIVABLE:
        return False
    access = tags.get("motorcar", tags.get("motor_vehicle", tags.get("vehicle", tags.get("access", "yes"))))
    return access not in {"no", "private", "agricultural", "forestry"} and tags.get("area") != "yes"


def number(value, fallback=None):
    match = re.search(r"[-+]?\d+(?:\.\d+)?", str(value))
    return float(match.group()) if match else fallback


def meters(value, fallback=None):
    n = number(value, fallback)
    if n is not None and any(unit in str(value).lower() for unit in ["ft", "feet", "'"]):
        n *= 0.3048
    return n


def speed_kph(tags):
    raw = tags.get("maxspeed", "")
    speed = number(raw)
    if speed is None:
        return 25 if tags.get("highway") in {"service", "living_street"} else 40
    return round(speed * 1.609344 if "mph" in raw else speed, 1)


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry] if geometry.length > 0.01 else []
    if hasattr(geometry, "geoms"):
        return [part for child in geometry.geoms for part in line_parts(child)]
    return []


def polygon_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry] if geometry.area > 4 else []
    if hasattr(geometry, "geoms"):
        return [part for child in geometry.geoms for part in polygon_parts(child)]
    return []


def densify(coords, interval):
    """Keep original OSM vertices while bounding horizontal sample spacing."""
    result = [tuple(coords[0][:2])]
    for a, b in zip(coords, coords[1:]):
        distance = math.hypot(b[0] - a[0], b[1] - a[1])
        count = max(1, math.ceil(distance / interval))
        for index in range(1, count + 1):
            t = index / count
            result.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return result


class Terrain:
    def __init__(self, path, config, easting, northing):
        self.size = config["sizeMeters"]
        self.half = self.size / 2
        self.width = config["terrainSamples"]
        self.cell = self.size / (self.width - 1)
        with rasterio.open(path) as src:
            if src.count != 1 or src.crs.to_epsg() != config["origin"]["epsg"]:
                raise ValueError("DEM must be one-band elevation in the configured projected CRS")
            if src.width != self.width or src.height != self.width:
                raise ValueError("DEM dimensions differ from configured vertex grid")
            north_first = src.read(1, masked=True)
            if np.ma.getmaskarray(north_first).any() or not np.isfinite(north_first).all():
                raise ValueError("DEM has missing elevation; refusing synthetic replacement")
            # Verify the download is aligned to tile vertices, not pixel edges.
            first_x, first_y = src.xy(0, 0)
            if abs(first_x - (easting-self.half)) > 0.02 or abs(first_y-(northing+self.half)) > 0.02:
                raise ValueError("DEM centers do not align with tile vertices")
            self.values = np.asarray(north_first, dtype=np.float64)[::-1, :].copy()
        if np.ptp(self.values) < 0.01:
            raise ValueError("DEM is unexpectedly flat; check source data")

    def sample(self, x, y):
        fx = min(max((x + self.half) / self.cell, 0), self.width - 1)
        fy = min(max((y + self.half) / self.cell, 0), self.width - 1)
        ix, iy = min(int(fx), self.width - 2), min(int(fy), self.width - 2)
        tx, ty = fx - ix, fy - iy
        a = self.values[iy, ix] * (1 - tx) + self.values[iy, ix + 1] * tx
        b = self.values[iy + 1, ix] * (1 - tx) + self.values[iy + 1, ix + 1] * tx
        return round(float(a * (1 - ty) + b * ty), 3)

    def point(self, coord):
        x, y = coord[:2]
        return [round(x, 3), round(y, 3), self.sample(x, y)]

    def serialize(self):
        return {"width": self.width, "height": self.width, "cellSize": self.cell,
                "rowOrder": "south-to-north", "columnOrder": "west-to-east", "heightUnits": "metres",
                "heightDatum": "USGS 3DEP source orthometric datum; see sources/usgs-catalog.json",
                "source": "USGS 3DEP bare-earth DEM", "resampling": "bilinear",
                "outputSampleSpacingMeters": self.cell,
                "nativeResolutionNote": "USGS multi-resolution mosaic; output spacing is not a claim of native resolution. Source catalog preserved.",
                "minElevation": round(float(self.values.min()), 3), "maxElevation": round(float(self.values.max()), 3),
                "heights": np.round(self.values, 3).ravel().tolist()}


def building_height(tags, default_levels):
    explicit = meters(tags.get("height"))
    levels = number(tags.get("building:levels"))
    if explicit and explicit > 0:
        return round(explicit, 2), levels or max(1, round(explicit / 3.1)), "osm:height"
    if levels and levels > 0:
        roof = meters(tags.get("roof:height"), 0) or 0
        return round(levels * 3.1 + roof, 2), levels, "estimated-from-osm:building:levels"
    return round(default_levels * 3.1, 2), default_levels, "inferred-default-no-osm-height"


def choose_style(config, lon, lat, tags):
    for area in config.get("neighbourhoodStyles", []):
        west, south, east, north = area["boundsLonLat"]
        if west <= lon <= east and south <= lat <= north:
            return area["style"]
    return config.get("defaultFacadeStyle", "generic-stucco")


def assemble_multipolygon(relation, ways, coords):
    outer, inner = [], []
    consumed = set()
    for member in relation.get("members", []):
        if member["type"] != "way" or member["ref"] not in ways:
            continue
        way = ways[member["ref"]]
        xy = [coords[n] for n in way.get("nodes", []) if n in coords]
        if len(xy) < 2:
            continue
        (inner if member.get("role") == "inner" else outer).append(LineString(xy))
        consumed.add(member["ref"])
    if not outer:
        return [], consumed
    # polygonize joins split member ways and handles unordered/reversed membership.
    shells = list(polygonize(unary_union(outer)))
    holes = list(polygonize(unary_union(inner))) if inner else []
    geometry = unary_union(shells)
    if holes:
        geometry = geometry.difference(unary_union(holes))
    return polygon_parts(geometry), consumed


def verify_sources(output):
    manifest = json.loads((output / "sources/manifest.json").read_text())
    for item in manifest["sources"]:
        path = output / item["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Source checksum mismatch: " + str(path))
    return manifest


def build(config, output):
    output = Path(output)
    manifest = verify_sources(output)
    osm = read_osm(output)
    origin = dict(config["origin"])
    forward = Transformer.from_crs(4326, origin["epsg"], always_xy=True)
    inverse = Transformer.from_crs(origin["epsg"], 4326, always_xy=True)
    e, n = forward.transform(origin["lon"], origin["lat"])
    origin.update(easting=e, northing=n)
    half = config["sizeMeters"] / 2
    boundary = box(-half, -half, half, half)
    terrain = Terrain(output / "sources/usgs-dem.tif", config, e, n)
    elements = osm["elements"]
    nodes = {el["id"]: el for el in elements if el["type"] == "node"}
    ways = {el["id"]: el for el in elements if el["type"] == "way"}
    coords = {}
    for node_id, node in nodes.items():
        px, py = forward.transform(node["lon"], node["lat"])
        coords[node_id] = (px - e, py - n)
    road_ways = [way for way in ways.values() if drivable(way.get("tags", {}))]
    roads, graph_nodes, graph_edges, source_usage = [], {}, [], defaultdict(set)
    road_by_way = defaultdict(list)
    for way in road_ways:
        tags = way.get("tags", {})
        ids = way.get("nodes", [])
        if len(ids) < 2 or any(node not in coords for node in ids):
            continue
        xy = [coords[node] for node in ids]
        original = LineString(xy)
        direction = oneway_direction(tags)
        lanes = max(1, int(number(tags.get("lanes"), 1 if direction else 2)))
        width = meters(tags.get("width"), lanes * 3.25)
        width = min(max(width, 3.0), 35.0)
        node_lookup = {(round(x, 6), round(y, 6)): str(node) for node, (x, y) in zip(ids, xy)}
        for part_index, part in enumerate(line_parts(original.intersection(boundary))):
            points_xy = list(part.coords)
            # Clipping operations are not allowed to reverse an OSM one-way way.
            if original.project(Point(points_xy[0])) > original.project(Point(points_xy[-1])):
                points_xy.reverse()
            sampled = densify(points_xy, config.get("roadSampleMeters", 5))
            road = {"id": f'{way["id"]}:{part_index}', "osmWayId": way["id"],
                    "name": tags.get("name", tags.get("ref", "Service road" if tags.get("highway") == "service" else "Unnamed street")),
                    "points": [terrain.point(p) for p in sampled], "width": round(width, 2), "lanes": lanes,
                    "oneway": direction, "surface": tags.get("surface", "asphalt"), "surfaceSource": "osm" if "surface" in tags else "default",
                    "highway": tags["highway"], "nodeIds": [node_lookup.get((round(x, 6), round(y, 6))) for x, y in sampled],
                    "sourceNodeIds": ids, "speedKph": speed_kph(tags), "bridge": tags.get("bridge", "no"),
                    "tunnel": tags.get("tunnel", "no"), "layer": int(number(tags.get("layer"), 0)), "tags": tags}
            roads.append(road)
            road_by_way[way["id"]].append((road, LineString(points_xy)))
        for aid, bid, a, b in zip(ids, ids[1:], xy, xy[1:]):
            segment = LineString([a, b])
            if segment.length < 0.01:
                continue
            for part in line_parts(segment.intersection(boundary)):
                p, q = list(part.coords)[0], list(part.coords)[-1]
                if segment.project(Point(p)) > segment.project(Point(q)):
                    p, q = q, p
                akey = str(aid) if Point(p).distance(Point(a)) < 0.001 else f'boundary:{way["id"]}:{aid}:{bid}:a'
                bkey = str(bid) if Point(q).distance(Point(b)) < 0.001 else f'boundary:{way["id"]}:{aid}:{bid}:b'
                for key, pos, source_id in [(akey, p, aid), (bkey, q, bid)]:
                    real = not key.startswith("boundary:")
                    graph_nodes[key] = {"id": key, "osmNodeId": source_id if real else None, "position": terrain.point(pos), "tags": nodes[source_id].get("tags", {}) if real else {}}
                    source_usage[key].add(way["id"])
                candidates = road_by_way[way["id"]]
                if not candidates:
                    continue
                midpoint = Point((p[0]+q[0])/2, (p[1]+q[1])/2)
                road = min(candidates, key=lambda item: item[1].distance(midpoint))[0]
                edge_points = [terrain.point(v) for v in densify([p, q], config.get("roadSampleMeters", 5))]
                for source, target, forward_direction in ([(akey, bkey, True)] if direction == 1 else [(bkey, akey, False)] if direction == -1 else [(akey,bkey,True),(bkey,akey,False)]):
                    graph_edges.append({"id": str(len(graph_edges)), "from": source, "to": target,
                                        "osmWayId": way["id"], "roadId": road["id"], "lengthMeters": round(part.length, 3),
                                        "speedKph": road["speedKph"], "points": edge_points if forward_direction else edge_points[::-1]})
    intersections = []
    for key, way_ids in source_usage.items():
        node = graph_nodes[key]
        tags = node["tags"]
        if len(way_ids) > 1 or tags.get("highway") in {"traffic_signals", "stop", "crossing"}:
            intersections.append({"id": key, "position": node["position"], "osmWayIds": sorted(way_ids),
                                  "control": "traffic_signals" if tags.get("highway") == "traffic_signals" else "stop" if tags.get("highway") == "stop" else "uncontrolled", "tags": tags})
    buildings, consumed = [], set()
    shapes = []
    for relation in elements:
        tags = relation.get("tags", {})
        if relation["type"] == "relation" and tags.get("building") and tags.get("building") != "no":
            polygons, member_ids = assemble_multipolygon(relation, ways, coords)
            if polygons:
                consumed.update(member_ids)
                shapes.extend((f'relation:{relation["id"]}', tags, polygon) for polygon in polygons)
    for way in ways.values():
        tags = way.get("tags", {})
        ids = way.get("nodes", [])
        if way["id"] in consumed or not tags.get("building") or tags.get("building") == "no":
            continue
        if len(ids) >= 4 and ids[0] == ids[-1] and all(node in coords for node in ids):
            geometry = Polygon([coords[node] for node in ids])
            if not geometry.is_valid:
                geometry = geometry.buffer(0)
            shapes.extend((f'way:{way["id"]}', tags, polygon) for polygon in polygon_parts(geometry))
    for source_id, tags, geometry in shapes:
        for part_index, part in enumerate(polygon_parts(geometry.intersection(boundary))):
            lon, lat = inverse.transform(part.centroid.x + e, part.centroid.y + n)
            height, levels, source = building_height(tags, config.get("defaultBuildingLevels", 3))
            buildings.append({"id": f'{source_id}:{len(buildings)}', "osmId": source_id, "name": tags.get("name", ""),
                              "footprint": [terrain.point(p) for p in list(part.exterior.coords)[:-1]],
                              "footprintHoles": [[terrain.point(p) for p in list(ring.coords)[:-1]] for ring in part.interiors],
                              "height": height, "levels": levels, "heightSource": source,
                              "style": choose_style(config, lon, lat, tags), "styleSource": "configured-neighbourhood-palette",
                              "tags": tags})
    restrictions = []
    imported_way_ids = {road["osmWayId"] for road in roads}
    for element in elements:
        if element["type"] == "relation" and element.get("tags", {}).get("type") == "restriction":
            members = element.get("members", [])
            if any(member["type"] == "way" and member["ref"] in imported_way_ids for member in members):
                restrictions.append({"osmRelationId": element["id"], "restriction": element["tags"].get("restriction", ""), "members": members, "tags": element["tags"], "fullyInTile": all(member["ref"] in imported_way_ids for member in members if member["type"] == "way")})
    landmarks = []
    for item in config.get("landmarks", []):
        item = dict(item)
        if item.get("osmType") and item.get("osmId"):
            landmark_source = output / f'sources/landmark-{item["osmType"]}-{item["osmId"]}.xml.gz'
            extracted = parse_osm_xml(gzip.decompress(landmark_source.read_bytes()))["elements"]
            feature = next(el for el in extracted if el["type"] == item["osmType"] and el["id"] == item["osmId"])
            if feature["type"] == "node":
                item.update(lat=feature["lat"],lon=feature["lon"],coordinateMethod="osm-node")
            else:
                landmark_nodes = {el["id"]:el for el in extracted if el["type"] == "node"}
                points = [forward.transform(landmark_nodes[key]["lon"],landmark_nodes[key]["lat"]) for key in feature["nodes"]]
                shape = Polygon(points) if feature["nodes"][0] == feature["nodes"][-1] else LineString(points)
                lon,lat = inverse.transform(shape.centroid.x,shape.centroid.y)
                item.update(lat=round(lat,8),lon=round(lon,8),coordinateMethod="projected-osm-footprint-centroid" if shape.geom_type == "Polygon" else "projected-osm-line-centroid")
            item["sourceUrl"] = f'https://www.openstreetmap.org/{item["osmType"]}/{item["osmId"]}'
        x, y = forward.transform(item["lon"], item["lat"])
        x, y = x-e, y-n
        inside = boundary.covers(Point(x, y))
        landmarks.append({**item, "position": [round(x,3), round(y,3), terrain.sample(x,y) if inside else None], "inPlayableArea": inside,
                          "elevationStatus": "sampled-dem" if inside else "outside-tile-no-elevation-sampled"})
    rails = []
    for way in ways.values():
        tags = way.get("tags", {})
        ids = way.get("nodes", [])
        if tags.get("railway") in {"tram", "light_rail", "rail"} and len(ids) > 1 and all(node in coords for node in ids):
            for part_index, part in enumerate(line_parts(LineString([coords[node] for node in ids]).intersection(boundary))):
                rails.append({"id": f'{way["id"]}:{part_index}', "points": [terrain.point(p) for p in densify(list(part.coords), 5)], "tags": tags})
    if not roads:
        raise ValueError("No drivable roads found")
    candidates = [road for road in roads if road["name"] == config.get("spawnRoad") and len(road["points"]) > 6] or roads
    chosen = min(candidates, key=lambda road: min(p[0]**2 + p[1]**2 for p in road["points"]))
    index = min(range(1, len(chosen["points"])-1), key=lambda i: chosen["points"][i][0]**2 + chosen["points"][i][1]**2)
    a, b = chosen["points"][index-1], chosen["points"][index+1]
    dx, dy = b[0]-a[0], b[1]-a[1]
    if chosen["oneway"] == -1:
        dx, dy = -dx, -dy
    length = math.hypot(dx,dy)
    # Right-hand traffic lane, using heading convention zero=north, positive=east.
    offset = min(chosen["width"] / 4, 1.7) if chosen["lanes"] > 1 else 0
    px = chosen["points"][index][0] + dy/length*offset
    py = chosen["points"][index][1] - dx/length*offset
    city = {"schemaVersion": 1, "id": config["id"], "name": config["name"], "origin": origin,
            "bounds": {"minX":-half,"maxX":half,"minY":-half,"maxY":half}, "terrain": terrain.serialize(),
            "roads": roads, "buildings": buildings, "intersections": intersections, "landmarks": landmarks, "railways": rails,
            "graph": {"nodes": list(graph_nodes.values()), "edges": graph_edges, "turnRestrictions": restrictions,
                      "directionConvention": "edges follow legal motorcar direction; road points preserve original OSM way order",
                      "turnRestrictionNote": "Consumers must apply relation restrictions; conditional restrictions are preserved as tags."},
            "spawn": {"position": terrain.point([px,py]), "headingRadians": round(math.atan2(dx,dy),6), "roadId": chosen["id"]},
            "provenance": manifest,
            "statistics": {"roadCount":len(roads),"buildingCount":len(buildings),"intersectionCount":len(intersections),
                           "roadLengthMeters":round(sum(LineString([p[:2] for p in road["points"]]).length for road in roads),1),
                           "onewayRoadCount":sum(road["oneway"] != 0 for road in roads),
                           "heightSources": dict(Counter(b["heightSource"] for b in buildings))},
            "limitations": ["Building facade appearance is a procedural neighbourhood palette, not photographic reconstruction.",
                            "Missing OSM building heights are explicitly marked estimates.",
                            "Ground DEM does not define bridge decks; bridges/tunnels need dedicated authored deck profiles before expansion.",
                            "Landmarks outside this 1 km tile have null elevation and are metadata only.",
                            "Bradford Street lies outside this initial Russian Hill tile."]}
    (output / "city.json").write_text(json.dumps(city, separators=(",", ":"), ensure_ascii=False) + "\n")
    (output / "summary.json").write_text(json.dumps({"id":city["id"],"origin":origin,"bounds":city["bounds"],"statistics":city["statistics"],"elevationRangeMeters":[city["terrain"]["minElevation"],city["terrain"]["maxElevation"]],"spawn":city["spawn"],"limitations":city["limitations"]},indent=2) + "\n")
    return city


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--download", action="store_true", help="Fetch fresh sources (otherwise offline reproducible build)")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    if args.download:
        fetch(config, args.output)
    city = build(config, args.output)
    print(json.dumps(city["statistics"], indent=2))


if __name__ == "__main__":
    main()
