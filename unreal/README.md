# City Wheels — Unreal Engine source

This is the C++/Blueprint source for the initial 1 km² San Francisco slice. The browser demo elsewhere in this repository is a separate implementation for immediate sharing; it is not an Unreal build.

**Native status:** source and bootstrap scripts are provided. This development host has neither Unreal Engine nor the required full platform toolchain. C++ compilation, `.uasset` generation, Unreal play testing, and native packaging have not been run. The blockout art is not photorealistic. No native executable is represented as delivered.

## Run on an Unreal development machine

Install Unreal Engine 5.6 and its supported native C++ toolchain. From this folder:

```sh
python3 Scripts/build.py --engine "/path/to/UE_5.6"
```

On Windows use `python`, and pass a path such as `C:/Program Files/Epic Games/UE_5.6`. The build script compiles the editor target, stages the geographic data, runs the full editor to create materials/Blueprints/the level, and verifies a fresh bootstrap success report. Open `CityWheels.uproject`, open `/Game/Maps/SanFrancisco`, and press Play.

To create a distributable native application for the current host platform:

```sh
python3 Scripts/build.py --engine "/path/to/UE_5.6" --package
```

The default archive folder is `unreal/Packaged`. Native platform signing, binary upload, and an actual executable play test follow a successful build. A GitHub repository alone does not make an Unreal executable playable in a browser. A production Unreal web launch would need a running GPU host and Pixel Streaming infrastructure, or downloadable platform builds.

## Included source

- `Source/CityWheels/Public/CityVehicle.h` and its `.cpp`: city-independent rigid-body vehicle with four raycast spring/damper contacts, load-sensitive tire grip curves, friction circle, rear-wheel drive, torque curve, automatic ratios, braking/reverse, aerodynamic drag, collision-induced engine/alignment damage, cameras, and headlights. AI can drive the same pawn through `SetDrivingInputs`.
- `CityWorld`: schema-versioned city JSON import, aggregate collision meshes for roads/buildings/terrain/rail tracks/paint/cobbles, mitered road bends, source-node junction patches, road-corridor terrain cuts, concave footprint roofs, facade style colors, runtime weather/wetness, sun, sky, fog, and streetlight changes.
- `CityGameMode`: spawn from city metadata and an on-screen speed/RPM/gear/engine HUD.
- `Scripts/bootstrap.py`: actual editable `BP_CityVehicle`, `BP_CityWorld`, `BP_CityGameMode`, `DA_StreetCoupe`, materials, and `/Game/Maps/SanFrancisco` creation. These binary assets exist only after a successful editor run.
- `Config`: Lumen GI/reflection project settings, mesh distance field generation setting, virtual shadow maps, atmospheric fog, physics substeps, inputs, map cooking, and loose CityData staging.

Controls: WASD/arrows drive; Space handbrake; Ctrl service brake; C chase/cockpit/orbit; mouse orbits; P freezes the car for photo framing; F9 saves a high-resolution screenshot; F changes clear/fog/rain; T advances four hours; L headlights; R recovers at the city spawn.

See [the engineering notes](../docs/unreal.md) for coordinate transforms, tuning, limitations, and the native acceptance procedure.
