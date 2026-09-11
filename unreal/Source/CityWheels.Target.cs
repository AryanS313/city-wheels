using UnrealBuildTool;
public class CityWheelsTarget : TargetRules
{
    public CityWheelsTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_6;
        ExtraModuleNames.Add("CityWheels");
    }
}
