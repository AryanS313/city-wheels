"""Acquire original sources, never substituting synthetic data for elevation."""
import concurrent.futures
import datetime
import hashlib
import gzip
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
from pyproj import Transformer

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def get_response(url, **kwargs):
    response = requests.get(url, timeout=180, headers={"User-Agent": "CityWheelsPrototype/1.0 (OpenStreetMap and USGS educational driving simulation)"}, **kwargs)
    response.raise_for_status()
    return response


def save_source(path, content, url, parameters=None, license_name=None):
    path.write_bytes(content)
    return {"file": "sources/" + path.name, "url": url, "request": parameters,
            "retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content), "license": license_name}


def download_osm(config, dest):
    origin = config["origin"]
    forward = Transformer.from_crs(4326, origin["epsg"], always_xy=True)
    inverse = Transformer.from_crs(origin["epsg"], 4326, always_xy=True)
    e, n = forward.transform(origin["lon"], origin["lat"])
    h = config["sizeMeters"] / 2 + config.get("sourceBufferMeters", 100)
    corners = [inverse.transform(e + x, n + y) for x in [-h, h] for y in [-h, h]]
    api_bbox = [min(x for x,y in corners), min(y for x,y in corners), max(x for x,y in corners), max(y for x,y in corners)]
    # For a starter tile the official map API is small, complete, and requires no
    # third-party mirror. Larger packages should tile requests or use a PBF extract.
    try:
        response = get_response("https://api.openstreetmap.org/api/0.6/map", params={"bbox": ",".join(map(str,api_bbox))})
        ET.fromstring(response.content)
        record = save_source(dest / "osm.xml.gz", gzip.compress(response.content, mtime=0), response.url,
                             {"bbox": api_bbox}, "ODbL-1.0")
        record.update(contentEncoding="gzip", originalContentSha256=hashlib.sha256(response.content).hexdigest())
        return record
    except Exception:
        pass  # Preserve live Overpass fallbacks for regions unsupported by map API.
    bbox = f'{min(y for x,y in corners)},{min(x for x,y in corners)},{max(y for x,y in corners)},{max(x for x,y in corners)}'
    query = f'''[out:json][timeout:120];
(way[highway]({bbox});way[building]({bbox});relation[building]({bbox});
relation[type=restriction]({bbox});way[railway]({bbox}););
(._;>>;);out meta;'''
    errors = []
    for endpoint in OVERPASS:
        try:
            response = get_response(endpoint, params={"data": query})
            payload = response.json()
            if payload.get("remark") or not payload.get("elements"):
                raise RuntimeError("Overpass returned incomplete/empty result: " + str(payload.get("remark")))
            return save_source(dest / "osm.json", response.content, response.url, {"query": query}, "ODbL-1.0")
        except Exception as exc:
            errors.append(str(exc))
    raise RuntimeError("OSM download failed; no fake road fallback. " + "; ".join(errors))


def read_osm(output):
    compressed = Path(output) / "sources/osm.xml.gz"
    if not compressed.exists():
        return json.loads((Path(output) / "sources/osm.json").read_text())
    return parse_osm_xml(gzip.decompress(compressed.read_bytes()))


def parse_osm_xml(content):
    root = ET.fromstring(content)
    elements = []
    for item in root:
        if item.tag not in {"node", "way", "relation"}:
            continue
        el = {"type": item.tag, **item.attrib, "id": int(item.attrib["id"])}
        if item.tag == "node":
            el.update(lat=float(el["lat"]), lon=float(el["lon"]))
        elif item.tag == "way":
            el["nodes"] = [int(node.attrib["ref"]) for node in item.findall("nd")]
        else:
            el["members"] = [{**member.attrib, "ref": int(member.attrib["ref"])} for member in item.findall("member")]
        el["tags"] = {tag.attrib["k"]: tag.attrib["v"] for tag in item.findall("tag")}
        elements.append(el)
    return {"version": 0.6, "generator": root.attrib.get("generator"), "elements": elements}


def download_landmarks(config, dest):
    records = []
    for landmark in config.get("landmarks", []):
        kind, osm_id = landmark.get("osmType"), landmark.get("osmId")
        if kind not in {"node", "way"} or not osm_id:
            continue
        endpoint = f'https://api.openstreetmap.org/api/0.6/{kind}/{osm_id}' + ("/full" if kind == "way" else "")
        response = get_response(endpoint)
        parse_osm_xml(response.content)
        record = save_source(dest / f'landmark-{kind}-{osm_id}.xml.gz', gzip.compress(response.content, mtime=0),
                             response.url, None, "ODbL-1.0")
        record.update(contentEncoding="gzip", originalContentSha256=hashlib.sha256(response.content).hexdigest())
        records.append(record)
    return records


def download_dem(config, dest):
    origin = config["origin"]
    forward = Transformer.from_crs(4326, origin["epsg"], always_xy=True)
    e, n = forward.transform(origin["lon"], origin["lat"])
    h = config["sizeMeters"] / 2
    samples = config["terrainSamples"]
    cell = config["sizeMeters"] / (samples - 1)
    # A half-cell apron aligns GeoTIFF pixel centers with the exact tile vertices.
    bbox = [e - h - cell/2, n - h - cell/2, e + h + cell/2, n + h + cell/2]
    service = config["elevationService"]
    params = {"f": "json", "bbox": ",".join(map(str,bbox)), "bboxSR": origin["epsg"],
              "imageSR": origin["epsg"], "size": f"{samples},{samples}", "format": "tiff", "pixelType": "F32",
              "interpolation": "RSP_BilinearInterpolation", "renderingRule": '{"rasterFunction":"None"}',
              "noDataInterpretation": "esriNoDataMatchAny"}
    response = get_response(service + "/exportImage", params=params)
    result = response.json()
    if "href" not in result:
        raise RuntimeError("USGS export failed; no fabricated DEM fallback: " + json.dumps(result))
    raster = get_response(result["href"])
    records = [save_source(dest / "usgs-dem.tif", raster.content, response.url, params, "USGS public domain"),
               save_source(dest / "usgs-export.json", response.content, response.url, params, "USGS public domain")]
    metadata = get_response(service, params={"f": "pjson"})
    records.append(save_source(dest / "usgs-service.json", metadata.content, metadata.url, None, "USGS public domain"))
    catalog_params = {"f": "json", "geometry": f"{e},{n}", "geometryType": "esriGeometryPoint", "inSR": origin["epsg"],
                      "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "false"}
    catalog = get_response(service + "/query", params=catalog_params)
    records.append(save_source(dest / "usgs-catalog.json", catalog.content, catalog.url, catalog_params, "USGS public domain"))
    return records


def fetch(config, output):
    dest = Path(output) / "sources"
    dest.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        osm = pool.submit(download_osm, config, dest)
        dem = pool.submit(download_dem, config, dest)
        landmarks = pool.submit(download_landmarks, config, dest)
        records = [osm.result()] + dem.result() + landmarks.result()
    manifest = {"sources": records, "osmAttribution": "© OpenStreetMap contributors", "osmLicense": "https://www.openstreetmap.org/copyright"}
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(fetch(json.loads(Path(args.config).read_text()), args.output), indent=2))
