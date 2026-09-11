"""Offline checks of real source fidelity and city-package geometry contracts."""
import hashlib
import json
import math
from pathlib import Path
import sys
import unittest

import numpy as np
import rasterio
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from build_city import assemble_multipolygon, building_height, densify, drivable, oneway_direction, Terrain
from fetch_sources import read_osm


class RealSanFranciscoDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = ROOT / "data/cities/san-francisco"
        cls.city = json.loads((cls.folder / "city.json").read_text())
        cls.config = json.loads((ROOT / "pipeline/configs/san-francisco.json").read_text())
        cls.osm = read_osm(cls.folder)
        cls.ways = {el["id"]: el for el in cls.osm["elements"] if el["type"] == "way"}
        cls.nodes = {el["id"]: el for el in cls.osm["elements"] if el["type"] == "node"}

    def test_exact_projected_square_and_source_checksums(self):
        c = self.city
        self.assertEqual(c["bounds"], {"minX": -500, "maxX": 500, "minY": -500, "maxY": 500})
        self.assertEqual(c["origin"]["epsg"], 32610)
        transformer = Transformer.from_crs(4326, 32610, always_xy=True)
        e, n = transformer.transform(-122.4169, 37.8024)
        self.assertAlmostEqual(e, c["origin"]["easting"], places=5)
        self.assertAlmostEqual(n, c["origin"]["northing"], places=5)
        for source in c["provenance"]["sources"]:
            content = (self.folder / source["file"]).read_bytes()
            self.assertEqual(hashlib.sha256(content).hexdigest(), source["sha256"])

    def test_dem_real_source_orientation_and_vertex_alignment(self):
        t = self.city["terrain"]
        self.assertEqual((t["width"], t["height"]), (257, 257))
        self.assertEqual(t["rowOrder"], "south-to-north")
        self.assertEqual(t["cellSize"] * (t["width"] - 1), 1000)
        with rasterio.open(self.folder / "sources/usgs-dem.tif") as source:
            original = source.read(1)
            first_x, first_y = source.xy(0, 0)
        exported = np.array(t["heights"]).reshape(t["height"], t["width"])
        self.assertTrue(np.allclose(exported, original[::-1], atol=0.000501))
        self.assertAlmostEqual(first_x, self.city["origin"]["easting"] - 500, places=2)
        self.assertAlmostEqual(first_y, self.city["origin"]["northing"] + 500, places=2)
        self.assertGreater(t["maxElevation"] - t["minElevation"], 90)

    def test_roads_preserve_source_positions_and_are_clipped_and_sampled(self):
        transformer = Transformer.from_crs(4326, 32610, always_xy=True)
        e, n = self.city["origin"]["easting"], self.city["origin"]["northing"]
        real_points_checked = 0
        for road in self.city["roads"]:
            original = self.ways[road["osmWayId"]]
            self.assertTrue(drivable(original["tags"]))
            self.assertEqual(road["oneway"], oneway_direction(original["tags"]))
            self.assertEqual(len(road["nodeIds"]), len(road["points"]))
            for node_id, point in zip(road["nodeIds"], road["points"]):
                self.assertTrue(-500.001 <= point[0] <= 500.001)
                self.assertTrue(-500.001 <= point[1] <= 500.001)
                if node_id:
                    node = self.nodes[int(node_id)]
                    px, py = transformer.transform(node["lon"], node["lat"])
                    self.assertAlmostEqual(point[0], px-e, delta=0.000501)
                    self.assertAlmostEqual(point[1], py-n, delta=0.000501)
                    real_points_checked += 1
            for a, b in zip(road["points"], road["points"][1:]):
                self.assertLessEqual(math.hypot(b[0]-a[0], b[1]-a[1]), 5.002)
        self.assertGreater(real_points_checked, 1000)

    def test_lombard_switchbacks_and_filbert_real_grade(self):
        crooked = [r for r in self.city["roads"] if r["osmWayId"] == 402111597]
        self.assertEqual(len(crooked), 1)
        self.assertEqual(crooked[0]["oneway"], 1)
        self.assertEqual(crooked[0]["surface"], "bricks")
        self.assertGreater(len(crooked[0]["points"]), 150)
        filbert = [r for r in self.city["roads"] if r["name"] == "Filbert Street" and r["tags"].get("incline") == "31.5%"]
        self.assertTrue(filbert)
        grades = []
        for road in filbert:
            for a, b in zip(road["points"], road["points"][1:]):
                distance = math.hypot(b[0]-a[0], b[1]-a[1])
                if distance > 0.1:
                    grades.append(abs(b[2]-a[2])/distance)
        self.assertGreater(max(grades), 0.25)

    def test_directed_graph_obeys_oneways_and_endpoints(self):
        graph = self.city["graph"]
        nodes = {node["id"]: node for node in graph["nodes"]}
        pairs = {(edge["osmWayId"], edge["from"], edge["to"]) for edge in graph["edges"]}
        for edge in graph["edges"]:
            self.assertEqual(edge["points"][0], nodes[edge["from"]]["position"])
            self.assertEqual(edge["points"][-1], nodes[edge["to"]]["position"])
            direction = oneway_direction(self.ways[edge["osmWayId"]]["tags"])
            reverse = (edge["osmWayId"], edge["to"], edge["from"])
            if direction:
                self.assertNotIn(reverse, pairs)
                a = nodes[edge["from"]]["osmNodeId"]
                b = nodes[edge["to"]]["osmNodeId"]
                if a and b:
                    ids = self.ways[edge["osmWayId"]]["nodes"]
                    oriented_pairs = set(zip(ids, ids[1:])) if direction == 1 else set(zip(ids[1:], ids))
                    self.assertIn((a,b), oriented_pairs)
            else:
                self.assertIn(reverse, pairs)

    def test_buildings_have_source_heights_or_honest_inference(self):
        self.assertGreater(len(self.city["buildings"]), 1000)
        explicit = 0
        for b in self.city["buildings"]:
            self.assertGreater(b["height"], 0)
            self.assertGreaterEqual(len(b["footprint"]), 3)
            self.assertIn(b["heightSource"], {"osm:height", "estimated-from-osm:building:levels", "inferred-default-no-osm-height"})
            explicit += b["heightSource"] == "osm:height"
            for x, y, z in b["footprint"]:
                self.assertTrue(-500.001 <= x <= 500.001 and -500.001 <= y <= 500.001)
        self.assertGreater(explicit, 1000)

    def test_landmarks_outside_tile_are_metadata_and_spawn_is_on_road(self):
        self.assertEqual(len(self.city["landmarks"]), 5)
        for landmark in self.city["landmarks"]:
            self.assertIn(landmark["coordinateMethod"], {"osm-node", "projected-osm-footprint-centroid", "projected-osm-line-centroid"})
            self.assertTrue(landmark["sourceUrl"].startswith("https://www.openstreetmap.org/"))
            x, y, z = landmark["position"]
            self.assertEqual(landmark["inPlayableArea"], -500 <= x <= 500 and -500 <= y <= 500)
            if not landmark["inPlayableArea"]:
                self.assertIsNone(z)
        road_ids = {road["id"] for road in self.city["roads"]}
        self.assertIn(self.city["spawn"]["roadId"], road_ids)


class ImportEdgeCaseTests(unittest.TestCase):
    def test_motor_vehicle_access_and_oneway_overrides(self):
        for highway in ["steps", "footway", "pedestrian", "cycleway", "path"]:
            self.assertFalse(drivable({"highway": highway}))
        self.assertFalse(drivable({"highway":"residential", "access":"private"}))
        self.assertTrue(drivable({"highway":"residential", "access":"no", "motor_vehicle":"yes"}))
        self.assertEqual(oneway_direction({"oneway":"-1"}), -1)
        self.assertEqual(oneway_direction({"junction":"roundabout"}), 1)
        self.assertEqual(oneway_direction({"junction":"roundabout", "oneway":"no"}), 0)

    def test_split_reversed_multipolygon_with_courtyard(self):
        coords = {1:(0,0),2:(10,0),3:(10,10),4:(0,10),5:(3,3),6:(7,3),7:(7,7),8:(3,7)}
        ways = {10:{"nodes":[1,2,3]},11:{"nodes":[1,4,3]},12:{"nodes":[5,6,7,8,5]}}
        relation = {"members":[{"type":"way","ref":11,"role":"outer"},{"type":"way","ref":10,"role":"outer"},{"type":"way","ref":12,"role":"inner"}]}
        polygons, consumed = assemble_multipolygon(relation, ways, coords)
        self.assertEqual(len(polygons),1)
        self.assertEqual(len(polygons[0].interiors),1)
        self.assertAlmostEqual(polygons[0].area,84)
        self.assertEqual(consumed,{10,11,12})

    def test_height_units_and_inference_labels(self):
        self.assertEqual(building_height({"height":"30 ft"},3)[0],9.14)
        self.assertEqual(building_height({"building:levels":"4"},3)[2],"estimated-from-osm:building:levels")
        self.assertEqual(building_height({},3)[2],"inferred-default-no-osm-height")

    def test_densification_keeps_original_vertices(self):
        points = densify([(0,0),(0,12),(9,12)],5)
        self.assertIn((0,12),points)
        self.assertEqual(points[-1],(9,12))
        self.assertTrue(all(math.dist(a,b)<=5 for a,b in zip(points,points[1:])))


if __name__ == "__main__":
    unittest.main()
