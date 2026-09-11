using UnrealBuildTool;
public class CityWheelsEditorTarget : TargetRules
{
    public CityWheelsEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_6;
        ExtraModuleNames.Add("CityWheels");
    }
}
