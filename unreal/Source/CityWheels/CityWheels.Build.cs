using UnrealBuildTool;
public class CityWheels : ModuleRules
{
    public CityWheels(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] {
            "Core", "CoreUObject", "Engine", "InputCore", "PhysicsCore", "ProceduralMeshComponent", "Json", "JsonUtilities"
        });
    }
}
