#!/usr/bin/env python3
"""Build native code, generate editor assets, and optionally package City Wheels.

Usage: python Scripts/build.py --engine /path/to/UE_5.6 --package
Run on a machine with Unreal Engine and its platform compiler already installed.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from stage_city import stage

PROJECT = Path(__file__).resolve().parents[1]

def find_engine(explicit):
    if explicit:
        candidates = [Path(explicit)]
    elif os.environ.get("UE_ROOT"):
        candidates = [Path(os.environ["UE_ROOT"])]
    else:
        candidates = [Path("/Users/Shared/Epic Games/UE_5.6"), Path("C:/Program Files/Epic Games/UE_5.6")]
    for candidate in candidates:
        if (candidate / "Engine" / "Build" / "Build.version").is_file():
            return candidate.resolve()
    raise RuntimeError("Unreal Engine was not found. Install UE 5.6 and pass --engine or set UE_ROOT. No native build was performed.")

def run(command, cwd=PROJECT):
    print("Running:", " ".join(str(part) for part in command), flush=True)
    # An argument list prevents shell interpretation of paths and user-provided engine locations.
    subprocess.run([str(part) for part in command], cwd=cwd, check=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path)
    parser.add_argument("--package", action="store_true", help="Cook and package a Development build after bootstrap")
    parser.add_argument("--output", type=Path, default=PROJECT / "Packaged")
    parser.add_argument("--skip-compile", action="store_true", help="Use an existing CityWheelsEditor build")
    args = parser.parse_args()
    engine = find_engine(args.engine)
    host = {"Darwin":"Mac", "Windows":"Win64", "Linux":"Linux"}.get(platform.system())
    if not host:
        raise RuntimeError(f"Unsupported build host {platform.system()}")
    batch = engine / "Engine" / "Build" / "BatchFiles"
    uproject = PROJECT / "CityWheels.uproject"
    if host == "Mac":
        build = [batch / "Mac" / "Build.sh"]
        editor = engine / "Engine" / "Binaries" / "Mac" / "UnrealEditor.app" / "Contents" / "MacOS" / "UnrealEditor"
        uat = [batch / "RunUAT.sh"]
    elif host == "Win64":
        build = ["cmd.exe", "/d", "/c", batch / "Build.bat"]
        editor = engine / "Engine" / "Binaries" / "Win64" / "UnrealEditor-Cmd.exe"
        uat = ["cmd.exe", "/d", "/c", batch / "RunUAT.bat"]
    else:
        build = [batch / "Linux" / "Build.sh"]
        editor = engine / "Engine" / "Binaries" / "Linux" / "UnrealEditor"
        uat = [batch / "RunUAT.sh"]
    if not editor.is_file():
        raise RuntimeError(f"Missing Unreal editor: {editor}")
    stage()
    if not args.skip_compile:
        run(build + ["CityWheelsEditor", host, "Development", f"-Project={uproject}", "-WaitMutex", "-NoHotReloadFromIDE"])
    report = PROJECT / "Saved" / "city-wheels-bootstrap.json"
    if report.exists():
        report.unlink()
    # The full editor path is required for LevelEditorSubsystem and material asset generation.
    # ExecutePythonScript exits the editor after completion (Epic's documented full-editor mode).
    run([editor, uproject, f"-ExecutePythonScript={PROJECT / 'Scripts' / 'bootstrap.py'}", "-unattended", "-nop4", "-nosplash", "-stdout", "-FullStdOutLogOutput"])
    if not report.is_file() or json.loads(report.read_text()).get("status") != "created":
        raise RuntimeError("Editor exited without a successful bootstrap report. Inspect Saved/Logs; packaging was not attempted.")
    if args.package:
        args.output.mkdir(parents=True, exist_ok=True)
        run(uat + ["BuildCookRun", f"-project={uproject}", "-noP4", f"-platform={host}", "-clientconfig=Development", "-build", "-cook", "-stage", "-pak", "-iostore", "-archive", f"-archivedirectory={args.output.resolve()}", "-utf8output"])
        print(f"Packaged application is in {args.output.resolve()}. Test the executable before releasing it.")
    else:
        print("Editor build and generated map complete. Open CityWheels.uproject, then press Play.")

if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print(f"City Wheels build stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
