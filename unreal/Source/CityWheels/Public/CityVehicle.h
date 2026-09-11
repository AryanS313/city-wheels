#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "Engine/DataAsset.h"
#include "Curves/CurveFloat.h"
#include "CityVehicle.generated.h"

class UBoxComponent;
class UPrimitiveComponent;
class UStaticMeshComponent;
class UCameraComponent;
class USpringArmComponent;
class USpotLightComponent;

/** SI units unless a name ends in Cm. Native defaults model a 1,450 kg RWD road car. */
UCLASS(BlueprintType)
class CITYWHEELS_API UCityVehicleTuning : public UDataAsset
{
    GENERATED_BODY()
public:
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Body", meta=(ClampMin="100")) float MassKg = 1450.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Body") FVector CenterOfMassCm = FVector(10,0,-2);
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Suspension") float SpringNPerM = 38000.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Suspension") float DamperNsPerM = 4200.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Suspension") float RestLengthM = .45f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Suspension") float BumpTravelM = .24f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Suspension") float DroopTravelM = .16f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Wheels") float RadiusM = .34f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Wheels") float DryGrip = 1.02f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Wheels") float WetGrip = .68f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Wheels") float LateralSlipStiffness = 8.5f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Wheels") float LongitudinalSlipStiffness = 10.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Drivetrain") FRuntimeFloatCurve TorqueNm;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Drivetrain") TArray<float> GearRatios = {3.54f, 2.16f, 1.48f, 1.12f, .88f, .72f};
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Drivetrain") float FinalDrive = 3.73f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Drivetrain") float DrivetrainEfficiency = .87f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Drivetrain") float IdleRpm = 850.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Drivetrain") float RedlineRpm = 6500.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Brakes") float BrakeForceN = 20000.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Steering") float MaxSteerDegrees = 34.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Body") float DragAreaM2 = .68f;
    UCityVehicleTuning();
};

USTRUCT(BlueprintType)
struct FCityWheelTelemetry
{
    GENERATED_BODY()
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) bool Grounded = false;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) float LoadN = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) float CompressionM = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) float SlipAngleDegrees = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) float LongitudinalSlip = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) float SurfaceGrip = 1;
};

/** Shared physics pawn: player or AI calls SetDrivingInputs; no city-specific knowledge. */
UCLASS(Blueprintable)
class CITYWHEELS_API ACityVehicle : public APawn
{
    GENERATED_BODY()
public:
    ACityVehicle();
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Vehicle") TObjectPtr<UBoxComponent> Chassis;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Vehicle") TObjectPtr<UCityVehicleTuning> Tuning;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Vehicle") TObjectPtr<UStaticMeshComponent> BodyVisual;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Vehicle") TArray<TObjectPtr<UStaticMeshComponent>> WheelVisuals;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Camera") TObjectPtr<UCameraComponent> Camera;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Camera") TObjectPtr<USpringArmComponent> SpringArm;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Telemetry") TArray<FCityWheelTelemetry> Wheels;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Telemetry") float SpeedKph = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Telemetry") float EngineRpm = 850;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Telemetry") int32 Gear = 1;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Damage") float EngineHealth = 1;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Damage") float WheelAlignmentDegrees = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Camera") int32 CameraMode = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Camera") bool bPhotoMode = false;
    UFUNCTION(BlueprintCallable, Category="Driving") void SetDrivingInputs(float Throttle, float Steering, float Brake, bool Handbrake);
    UFUNCTION(BlueprintCallable, Category="Driving") void ResetVehicle();
    UFUNCTION(BlueprintCallable, Category="Driving") void RepairVehicle();
    UFUNCTION(BlueprintCallable, Category="Camera") void CycleCamera();
    UFUNCTION(BlueprintCallable, Category="World") void CycleWeather();
    UFUNCTION(BlueprintCallable, Category="World") void CycleTime();
    UFUNCTION(BlueprintCallable, Category="Lights") void ToggleHeadlights();
    UFUNCTION(BlueprintCallable, Category="Camera") void TogglePhotoMode();
    UFUNCTION(BlueprintImplementableEvent, Category="Damage") void OnDamageChanged(float Health, float AlignmentDegrees, FVector WorldImpact);
    void SetResetTransform(const FTransform& Transform);
protected:
    virtual void BeginPlay() override;
private:
    UPROPERTY() TArray<TObjectPtr<USpotLightComponent>> Headlights;
    FVector Attachments[4] = {FVector(132,-77,22),FVector(132,77,22),FVector(-132,-77,22),FVector(-132,77,22)};
    float WheelSpin[4] = {};
    float ThrottleInput = 0, SteeringInput = 0, BrakeInput = 0, SmoothedSteer = 0;
    float ShiftCooldown = 0, OrbitYaw = 0, OrbitPitch = -14;
    bool bHandbrake = false, bHeadlights = false;
    FTransform ResetTransform;
    void SimulateContacts(float DeltaSeconds);
    void UpdateCamera();
    void ThrottleAxis(float Value) { ThrottleInput = Value; }
    void SteeringAxis(float Value) { SteeringInput = Value; }
    void LookYaw(float Value);
    void LookPitch(float Value);
    void BrakeOn() { BrakeInput = 1; }
    void BrakeOff() { BrakeInput = 0; }
    void HandbrakeOn() { bHandbrake = true; }
    void HandbrakeOff() { bHandbrake = false; }
    void Screenshot();
    UFUNCTION() void OnChassisHit(UPrimitiveComponent* HitComponent, AActor* OtherActor, UPrimitiveComponent* OtherComponent, FVector NormalImpulse, const FHitResult& Hit);
};
