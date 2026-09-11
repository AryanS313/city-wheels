"""Run INSIDE the UE 5.6 editor after compiling CityWheelsEditor.

Creates real editable .uasset Blueprints/materials and a .umap from source.
No UE binary assets are represented as if generated before this script runs.
"""
from pathlib import Path
import json
import math
import unreal

ASSETS = "/Game/CityWheels"
MAP = "/Game/Maps/SanFrancisco"
tools = unreal.AssetToolsHelpers.get_asset_tools()
library = unreal.MaterialEditingLibrary

def asset(name, cls, factory):
    path = f"{ASSETS}/{name}"
    existing = unreal.EditorAssetLibrary.load_asset(path)
    return existing or tools.create_asset(name, ASSETS, cls, factory)

def expression(material, cls, x=0, y=0, **properties):
    node = library.create_material_expression(material, cls, x, y)
    for key, value in properties.items():
        node.set_editor_property(key, value)
    return node

def constant(material, value, x=0, y=0):
    return expression(material, unreal.MaterialExpressionConstant, x, y, r=float(value))

def connect(source, target, pin, output=""):
    if not library.connect_material_expressions(source, output, target, pin):
        raise RuntimeError(f"Cannot connect {source.get_name()} -> {target.get_name()}.{pin}")

def output(source, material, prop, pin=""):
    if not library.connect_material_property(source, pin, prop):
        raise RuntimeError(f"Cannot connect material property {prop}")

def finish(material):
    library.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material)
    return material

def make_surface():
    mat = asset("M_CitySurface", unreal.Material, unreal.MaterialFactoryNew())
    library.delete_all_material_expressions(mat)
    color = expression(mat, unreal.MaterialExpressionVertexColor, -700, -180)
    wet = expression(mat, unreal.MaterialExpressionScalarParameter, -700, 200, parameter_name="Wetness", default_value=0.0)
    roughness = expression(mat, unreal.MaterialExpressionLinearInterpolate, -230, 220)
    connect(constant(mat, .86), roughness, "A")
    connect(constant(mat, .14), roughness, "B")
    connect(wet, roughness, "Alpha")
    darkness = expression(mat, unreal.MaterialExpressionLinearInterpolate, -450, 0)
    connect(constant(mat, 1), darkness, "A")
    connect(constant(mat, .55), darkness, "B")
    connect(wet, darkness, "Alpha")
    dark_color = expression(mat, unreal.MaterialExpressionMultiply, -220, -150)
    connect(color, dark_color, "A", "RGB")
    connect(darkness, dark_color, "B")
    output(dark_color, mat, unreal.MaterialProperty.MP_BASE_COLOR)
    output(roughness, mat, unreal.MaterialProperty.MP_ROUGHNESS)
    return finish(mat)

def make_facade():
    mat = asset("M_Facade", unreal.Material, unreal.MaterialFactoryNew())
    library.delete_all_material_expressions(mat)
    uv = expression(mat, unreal.MaterialExpressionTextureCoordinate, -750, -150)
    color = expression(mat, unreal.MaterialExpressionVertexColor, -750, 0)
    night = expression(mat, unreal.MaterialExpressionScalarParameter, -750, 160, parameter_name="Night", default_value=0.0)
    shader = expression(mat, unreal.MaterialExpressionCustom, -280, -100,
        code="float2 f=frac(UV); float w=step(.20,f.x)*step(f.x,.80)*step(.24,f.y)*step(f.y,.78); return lerp(Tint,float3(.045,.075,.09)+float3(.42,.25,.08)*Night,w);",
        output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3,
        description="Procedural facade blockout, replace with neighbourhood PBR art")
    inputs = []
    for name in ("UV", "Tint", "Night"):
        item = unreal.CustomInput()
        item.set_editor_property("input_name", name)
        inputs.append(item)
    shader.set_editor_property("inputs", inputs)
    connect(uv, shader, "UV")
    connect(color, shader, "Tint", "RGB")
    connect(night, shader, "Night")
    output(shader, mat, unreal.MaterialProperty.MP_BASE_COLOR)
    output(constant(mat, .55), mat, unreal.MaterialProperty.MP_ROUGHNESS)
    return finish(mat)

def make_solid(name, color, roughness, metallic=0):
    mat = asset(name, unreal.Material, unreal.MaterialFactoryNew())
    library.delete_all_material_expressions(mat)
    base = expression(mat, unreal.MaterialExpressionConstant3Vector, -250, -100, constant=unreal.LinearColor(*color, 1.0))
    output(base, mat, unreal.MaterialProperty.MP_BASE_COLOR)
    output(constant(mat, roughness), mat, unreal.MaterialProperty.MP_ROUGHNESS)
    output(constant(mat, metallic), mat, unreal.MaterialProperty.MP_METALLIC)
    return finish(mat)

def blueprint(name, native_name):
    parent = unreal.load_class(None, f"/Script/CityWheels.{native_name}")
    if parent is None:
        raise RuntimeError("Build the CityWheelsEditor C++ target before running bootstrap.py")
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", parent)
    bp = asset(name, unreal.Blueprint, factory)
    return bp, unreal.EditorAssetLibrary.load_blueprint_class(f"{ASSETS}/{name}")

def main():
    unreal.EditorAssetLibrary.make_directory(ASSETS)
    unreal.EditorAssetLibrary.make_directory("/Game/Maps")
    surface, facade = make_surface(), make_facade()
    red = make_solid("M_CarPaint", (.47,.035,.018), .19, .65)
    rubber = make_solid("M_Tire", (.014,.018,.019), .95)
    glass = make_solid("M_GlassBlockout", (.06,.13,.17), .08, .7)
    rain = make_solid("M_Rain", (.36,.44,.5), .13)
    vehicle_bp, vehicle_class = blueprint("BP_CityVehicle", "CityVehicle")
    world_bp, world_class = blueprint("BP_CityWorld", "CityWorld")
    mode_bp, mode_class = blueprint("BP_CityGameMode", "CityGameMode")

    tuning_factory = unreal.DataAssetFactory()
    tuning_factory.set_editor_property("data_asset_class", unreal.load_class(None, "/Script/CityWheels.CityVehicleTuning"))
    tuning = asset("DA_StreetCoupe", unreal.DataAsset, tuning_factory)
    vehicle_defaults = unreal.get_default_object(vehicle_class)
    vehicle_defaults.set_editor_property("tuning", tuning)
    vehicle_defaults.get_editor_property("body_visual").set_material(0, red)
    for wheel in vehicle_defaults.get_editor_property("wheel_visuals"):
        wheel.set_material(0, rubber)
    for component in vehicle_defaults.get_components_by_class(unreal.StaticMeshComponent):
        if component.get_name() == "CabinVisual":
            component.set_material(0, glass)
        elif component.get_name() == "DashboardVisual":
            component.set_material(0, rubber)
    world_defaults = unreal.get_default_object(world_class)
    world_defaults.set_editor_property("surface_material", surface)
    world_defaults.set_editor_property("facade_material", facade)
    world_defaults.set_editor_property("rain_material", rain)
    unreal.get_default_object(mode_class).set_editor_property("default_pawn_class", vehicle_class)
    for bp in (vehicle_bp, world_bp, mode_bp):
        unreal.BlueprintEditorLibrary.compile_blueprint(bp)
        unreal.EditorAssetLibrary.save_loaded_asset(bp)
    unreal.EditorAssetLibrary.save_loaded_asset(tuning)

    editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if unreal.EditorAssetLibrary.does_asset_exist(MAP):
        if not editor.load_level(MAP):
            raise RuntimeError(f"Failed to load {MAP}")
        for actor in actors.get_all_level_actors():
            if "CityWheelsGenerated" in [str(tag) for tag in actor.tags]:
                actors.destroy_actor(actor)
    elif not editor.new_level(MAP):
        raise RuntimeError(f"Failed to create {MAP}")
    world = actors.spawn_actor_from_class(world_class, unreal.Vector(0,0,0))
    world.set_actor_label("San Francisco — city package")
    world.tags = ["CityWheelsGenerated"]
    if not world.load_city():
        raise RuntimeError(world.get_editor_property("last_load_error"))
    spawn = world.get_editor_property("spawn_transform")
    start = actors.spawn_actor_from_class(unreal.PlayerStart, spawn.translation, spawn.rotation.rotator())
    start.tags = ["CityWheelsGenerated"]
    start.set_actor_label("City package spawn")
    editor_world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    editor_world.get_world_settings().set_editor_property("default_game_mode", mode_class)
    if not editor.save_current_level():
        raise RuntimeError("Could not save generated city level")
    unreal.EditorAssetLibrary.save_directory(ASSETS, only_if_is_dirty=False, recursive=True)
    unreal.log("City Wheels bootstrap complete. Open /Game/Maps/SanFrancisco and press Play.")
    report = Path(unreal.Paths.project_saved_dir()) / "city-wheels-bootstrap.json"
    report.write_text(json.dumps({"status":"created", "map":MAP, "roads":len(world.get_editor_property("roads")), "engine":unreal.SystemLibrary.get_engine_version()}, indent=2))

main()
