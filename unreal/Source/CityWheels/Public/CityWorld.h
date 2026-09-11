#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CityWorld.generated.h"

class UProceduralMeshComponent;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UDirectionalLightComponent;
class USkyLightComponent;
class USkyAtmosphereComponent;
class UExponentialHeightFogComponent;
class UInstancedStaticMeshComponent;
class UPointLightComponent;

USTRUCT(BlueprintType)
struct FCityRoad
{
    GENERATED_BODY()
    UPROPERTY(BlueprintReadOnly) FString Id;
    UPROPERTY(BlueprintReadOnly) FString Name;
    UPROPERTY(BlueprintReadOnly) TArray<FVector> Points;
    UPROPERTY(BlueprintReadOnly) TArray<FString> NodeIds;
    UPROPERTY(BlueprintReadOnly) float WidthCm = 700;
    UPROPERTY(BlueprintReadOnly) float SpeedKph = 40;
    UPROPERTY(BlueprintReadOnly) int32 Lanes = 2;
    UPROPERTY(BlueprintReadOnly) int32 OneWay = 0;
    UPROPERTY(BlueprintReadOnly) FString Surface;
};

UCLASS(Blueprintable)
class CITYWHEELS_API ACityWorld : public AActor
{
    GENERATED_BODY()
public:
    ACityWorld();
    virtual void Tick(float DeltaSeconds) override;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="City") FString CityPackage = TEXT("san-francisco");
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="City") FString CityFileOverride;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Materials") TObjectPtr<UMaterialInterface> SurfaceMaterial;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Materials") TObjectPtr<UMaterialInterface> FacadeMaterial;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Materials") TObjectPtr<UMaterialInterface> RainMaterial;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="City") FString CityDisplayName;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="City") TArray<FCityRoad> Roads;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="City") FTransform SpawnTransform;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="City") bool bCityLoaded = false;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="City") FString LastLoadError;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Environment", meta=(ClampMin="0",ClampMax="24")) float TimeOfDay = 16;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Environment") float DayLengthMinutes = 48;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Environment") bool bAnimateTime = true;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Environment") float Wetness = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Environment") int32 Weather = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Geometry") TObjectPtr<UProceduralMeshComponent> TerrainMesh;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Geometry") TObjectPtr<UProceduralMeshComponent> RoadMesh;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Geometry") TObjectPtr<UProceduralMeshComponent> CobbleMesh;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Geometry") TObjectPtr<UProceduralMeshComponent> PaintMesh;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Geometry") TObjectPtr<UProceduralMeshComponent> TrackMesh;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Geometry") TObjectPtr<UProceduralMeshComponent> BuildingMesh;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Lighting") TObjectPtr<UDirectionalLightComponent> Sun;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Lighting") TObjectPtr<USkyLightComponent> SkyLight;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Lighting") TObjectPtr<USkyAtmosphereComponent> Atmosphere;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Lighting") TObjectPtr<UExponentialHeightFogComponent> Fog;
    UFUNCTION(BlueprintCallable, CallInEditor, Category="City") bool LoadCity();
    UFUNCTION(BlueprintCallable, Category="Environment") void CycleWeather();
    UFUNCTION(BlueprintCallable, Category="Environment") void SetTimeOfDay(float Hours);
    UFUNCTION(BlueprintImplementableEvent, Category="City") void OnCityLoaded();
protected:
    virtual void BeginPlay() override;
private:
    UPROPERTY() TArray<TObjectPtr<UMaterialInstanceDynamic>> DynamicMaterials;
    UPROPERTY() TArray<TObjectPtr<UPointLightComponent>> StreetLights;
    UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> RainStreaks;
    TArray<FVector> RainOffsets;
    float EnvironmentAccumulator=0, RainTime=0;
    void UpdateEnvironment(float DeltaSeconds);
};
