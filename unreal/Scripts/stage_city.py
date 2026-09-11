#!/usr/bin/env python3
"""Stage one validated, distributable data package as loose Unreal content."""
import argparse
import json
from pathlib import Path
import shutil

def stage(city="san-francisco", source=None):
    project = Path(__file__).resolve().parents[1]
    source = Path(source).resolve() if source else project.parent / "data" / "cities" / city
    data = json.loads((source / "city.json").read_text())
    if data.get("schemaVersion") != 1:
        raise ValueError("Expected schemaVersion 1")
    terrain = data["terrain"]
    if len(terrain["heights"]) != terrain["width"] * terrain["height"]:
        raise ValueError("Terrain dimensions do not match height samples")
    if not data["roads"] or not data["buildings"]:
        raise ValueError("An empty city is not a usable initial slice")
    destination = project / "Content" / "CityData" / city
    destination.mkdir(parents=True, exist_ok=True)
    for filename in ("city.json", "summary.json", "attribution.md", "ATTRIBUTION.md"):
        if (source / filename).exists():
            shutil.copy2(source / filename, destination / filename)
    notice = project.parent / "NOTICE"
    if notice.exists():
        shutil.copy2(notice, destination / "ATTRIBUTION.txt")
    # Provenance is already embedded in city.json; the bulky source rasters are not runtime assets.
    print(f"Staged {len(data['roads'])} roads and {len(data['buildings'])} buildings to {destination}")
    return destination

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--city", default="san-francisco")
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    stage(args.city, args.source)
