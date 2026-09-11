#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "CityGameMode.generated.h"

UCLASS(Blueprintable)
class CITYWHEELS_API ACityGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    ACityGameMode();
    virtual void StartPlay() override;
};

UCLASS()
class CITYWHEELS_API ACityHUD : public AHUD
{
    GENERATED_BODY()
public:
    virtual void DrawHUD() override;
};
