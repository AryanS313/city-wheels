#include "CityGameMode.h"
#include "CityVehicle.h"
#include "CityWorld.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"

ACityGameMode::ACityGameMode()
{
    DefaultPawnClass=ACityVehicle::StaticClass();
    HUDClass=ACityHUD::StaticClass();
}

void ACityGameMode::StartPlay()
{
    Super::StartPlay();
    ACityWorld* City=nullptr;
    for (TActorIterator<ACityWorld> It(GetWorld());It;++It) { City=*It; break; }
    if (!City) City=GetWorld()->SpawnActor<ACityWorld>();
    if (City && City->bCityLoaded)
    {
        for (FConstPlayerControllerIterator It=GetWorld()->GetPlayerControllerIterator();It;++It)
        {
            APlayerController* PC=It->Get();
            ACityVehicle* Vehicle=PC ? Cast<ACityVehicle>(PC->GetPawn()) : nullptr;
            if (Vehicle) { Vehicle->SetResetTransform(City->SpawnTransform); Vehicle->ResetVehicle(); }
        }
    }
}

void ACityHUD::DrawHUD()
{
    Super::DrawHUD(); if (!Canvas) return;
    ACityVehicle* Car=GetOwningPlayerController() ? Cast<ACityVehicle>(GetOwningPlayerController()->GetPawn()) : nullptr;
    if (Car && Car->bPhotoMode) return;
    const float Width=Canvas->SizeX, Height=Canvas->SizeY;
    DrawRect(FLinearColor(.025,.035,.045,.84),22,22,405,92);
    DrawText(TEXT("CITY WHEELS"),FLinearColor(.95,.75,.31),40,35,GEngine->GetLargeFont(),1.0f);
    FString CityLabel=TEXT("GEOGRAPHIC PROTOTYPE");
    for (TActorIterator<ACityWorld> It(GetWorld());It;++It) { CityLabel=It->CityDisplayName.ToUpper()+TEXT(" / PROTOTYPE"); break; }
    DrawText(CityLabel,FLinearColor(.83,.88,.90),40,79,GEngine->GetSmallFont(),1.f);
    DrawRect(FLinearColor(.025,.035,.045,.84),22,Height-115,585,93);
    DrawText(TEXT("WASD drive   SPACE handbrake   CTRL brake   R recover"),FLinearColor::White,38,Height-101,GEngine->GetSmallFont());
    DrawText(TEXT("C camera   P photo mode   Mouse orbit   F9 screenshot"),FLinearColor::White,38,Height-77,GEngine->GetSmallFont());
    DrawText(TEXT("F weather   T time   L headlights  |  OSM contributors / USGS"),FLinearColor(.68,.76,.79),38,Height-53,GEngine->GetSmallFont());
    if (Car)
    {
        DrawRect(FLinearColor(.025,.035,.045,.86),Width-245,Height-160,223,138);
        DrawText(FString::Printf(TEXT("%03.0f"),Car->SpeedKph),FLinearColor::White,Width-225,Height-148,GEngine->GetLargeFont(),2);
        DrawText(TEXT("KM/H"),FLinearColor(.75,.80,.83),Width-120,Height-110,GEngine->GetSmallFont());
        DrawText(FString::Printf(TEXT("GEAR %d    %.0f RPM"),Car->Gear,Car->EngineRpm),FLinearColor(.95,.75,.31),Width-225,Height-74,GEngine->GetSmallFont());
        DrawText(FString::Printf(TEXT("ENGINE %.0f%%"),Car->EngineHealth*100),FLinearColor::White,Width-225,Height-48,GEngine->GetSmallFont());
    }
    for (TActorIterator<ACityWorld> It(GetWorld());It;++It)
    {
        if (!It->LastLoadError.IsEmpty()) DrawText(It->LastLoadError,FLinearColor::Red,40,140,GEngine->GetSmallFont());
        break;
    }
}
