#include "CityVehicle.h"
#include "CityWorld.h"
#include "Camera/CameraComponent.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/InputComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/PlayerController.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Engine/StaticMesh.h"
#include "Kismet/GameplayStatics.h"
#include "UObject/ConstructorHelpers.h"
#include <cmath>

UCityVehicleTuning::UCityVehicleTuning()
{
    FRichCurve* Curve = TorqueNm.GetRichCurve();
    Curve->AddKey(850,130); Curve->AddKey(1500,200); Curve->AddKey(2500,255);
    Curve->AddKey(3800,290); Curve->AddKey(4800,285); Curve->AddKey(5800,260); Curve->AddKey(6500,215);
}

ACityVehicle::ACityVehicle()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PrePhysics;
    Chassis = CreateDefaultSubobject<UBoxComponent>(TEXT("Chassis"));
    SetRootComponent(Chassis);
    Chassis->SetBoxExtent(FVector(205,87,30));
    Chassis->SetCollisionProfileName(TEXT("PhysicsActor"));
    Chassis->SetSimulatePhysics(true);
    Chassis->SetNotifyRigidBodyCollision(true);
    Chassis->BodyInstance.bUseCCD = true;
    Chassis->SetLinearDamping(.02f);
    Chassis->SetAngularDamping(.25f);

    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    BodyVisual = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BodyVisual"));
    BodyVisual->SetupAttachment(Chassis);
    BodyVisual->SetStaticMesh(Cube.Object);
    BodyVisual->SetRelativeScale3D(FVector(4.10,1.78,.60));
    BodyVisual->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    UStaticMeshComponent* Cabin = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("CabinVisual"));
    Cabin->SetupAttachment(Chassis); Cabin->SetStaticMesh(Cube.Object);
    Cabin->SetRelativeLocation(FVector(-20,0,55)); Cabin->SetRelativeScale3D(FVector(2.05,1.53,.65));
    Cabin->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    UStaticMeshComponent* Dashboard = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("DashboardVisual"));
    Dashboard->SetupAttachment(Chassis); Dashboard->SetStaticMesh(Cube.Object);
    Dashboard->SetRelativeLocation(FVector(67,0,50)); Dashboard->SetRelativeScale3D(FVector(.25,1.42,.18));
    Dashboard->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    for (int32 I=0; I<4; ++I)
    {
        UStaticMeshComponent* Wheel = CreateDefaultSubobject<UStaticMeshComponent>(*FString::Printf(TEXT("Wheel%d"),I));
        Wheel->SetupAttachment(Chassis); Wheel->SetStaticMesh(Cylinder.Object);
        Wheel->SetRelativeScale3D(FVector(.68,.68,.22));
        Wheel->SetRelativeRotation(FRotator(0,0,90));
        Wheel->SetCollisionEnabled(ECollisionEnabled::NoCollision); WheelVisuals.Add(Wheel);
    }
    for (int32 I=0; I<2; ++I)
    {
        USpotLightComponent* Light = CreateDefaultSubobject<USpotLightComponent>(*FString::Printf(TEXT("Headlight%d"),I));
        Light->SetupAttachment(Chassis); Light->SetRelativeLocation(FVector(208,I==0 ? -62 : 62,6));
        Light->SetRelativeRotation(FRotator(-3,0,0)); Light->SetIntensity(90000);
        Light->SetAttenuationRadius(16000); Light->SetInnerConeAngle(16); Light->SetOuterConeAngle(29);
        Light->SetLightColor(FLinearColor(1,.93,.82)); Light->SetVisibility(false); Headlights.Add(Light);
    }
    SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
    SpringArm->SetupAttachment(Chassis); SpringArm->TargetArmLength = 680;
    SpringArm->SetRelativeLocation(FVector(0,0,100)); SpringArm->SetRelativeRotation(FRotator(-14,0,0));
    SpringArm->bEnableCameraLag = true; SpringArm->CameraLagSpeed = 8;
    SpringArm->bInheritPitch = false; SpringArm->bInheritRoll = false;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera")); Camera->SetupAttachment(SpringArm);
    Camera->FieldOfView = 78;
    Wheels.SetNum(4);
}

void ACityVehicle::BeginPlay()
{
    Super::BeginPlay();
    if (!Tuning) Tuning = NewObject<UCityVehicleTuning>(this);
    Chassis->SetMassOverrideInKg(NAME_None,Tuning->MassKg,true);
    Chassis->SetCenterOfMass(Tuning->CenterOfMassCm);
    Chassis->OnComponentHit.AddDynamic(this,&ACityVehicle::OnChassisHit);
    ResetTransform = GetActorTransform();
}

void ACityVehicle::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis("Throttle",this,&ACityVehicle::ThrottleAxis);
    Input->BindAxis("Steer",this,&ACityVehicle::SteeringAxis);
    Input->BindAxis("LookYaw",this,&ACityVehicle::LookYaw);
    Input->BindAxis("LookPitch",this,&ACityVehicle::LookPitch);
    Input->BindAction("Brake",IE_Pressed,this,&ACityVehicle::BrakeOn);
    Input->BindAction("Brake",IE_Released,this,&ACityVehicle::BrakeOff);
    Input->BindAction("Handbrake",IE_Pressed,this,&ACityVehicle::HandbrakeOn);
    Input->BindAction("Handbrake",IE_Released,this,&ACityVehicle::HandbrakeOff);
    Input->BindAction("Camera",IE_Pressed,this,&ACityVehicle::CycleCamera);
    Input->BindAction("Reset",IE_Pressed,this,&ACityVehicle::ResetVehicle);
    Input->BindAction("Weather",IE_Pressed,this,&ACityVehicle::CycleWeather);
    Input->BindAction("Time",IE_Pressed,this,&ACityVehicle::CycleTime);
    Input->BindAction("Headlights",IE_Pressed,this,&ACityVehicle::ToggleHeadlights);
    Input->BindAction("Screenshot",IE_Pressed,this,&ACityVehicle::Screenshot);
    Input->BindAction("PhotoMode",IE_Pressed,this,&ACityVehicle::TogglePhotoMode);
}

void ACityVehicle::SetDrivingInputs(float Throttle,float Steering,float Brake,bool Handbrake)
{
    ThrottleInput=FMath::Clamp(Throttle,-1.f,1.f); SteeringInput=FMath::Clamp(Steering,-1.f,1.f);
    BrakeInput=FMath::Clamp(Brake,0.f,1.f); bHandbrake=Handbrake;
}

void ACityVehicle::Tick(float Dt)
{
    Super::Tick(Dt);
    if (!Tuning) return;
    if (!bPhotoMode) SimulateContacts(FMath::Clamp(Dt, .001f, .05f));
    UpdateCamera();
    if (GetActorLocation().Z < -100000) ResetVehicle();
}

void ACityVehicle::SimulateContacts(float Dt)
{
    const FVector VelocityM = Chassis->GetPhysicsLinearVelocity()/100.f;
    const FVector Forward = GetActorForwardVector();
    const FVector Up = GetActorUpVector();
    const float ForwardSpeed = FVector::DotProduct(VelocityM,Forward);
    SpeedKph = VelocityM.Size()*3.6f;
    const bool Reverse = ThrottleInput < -.05f && ForwardSpeed < .6f;
    float Drive = ThrottleInput;
    float Brake = BrakeInput;
    if (ThrottleInput*ForwardSpeed < -.2f) { Brake=FMath::Max(Brake,FMath::Abs(ThrottleInput)); Drive=0; }
    if (Tuning->GearRatios.Num()==0) return;
    Gear=FMath::Clamp(Gear,1,Tuning->GearRatios.Num());
    float Ratio = Reverse ? 3.2f : Tuning->GearRatios[Gear-1];
    const float WheelRpm = FMath::Abs(ForwardSpeed)/(2*PI*Tuning->RadiusM)*60;
    EngineRpm=FMath::Clamp(FMath::Max(Tuning->IdleRpm,WheelRpm*Ratio*Tuning->FinalDrive),Tuning->IdleRpm,Tuning->RedlineRpm);
    ShiftCooldown=FMath::Max(0.f,ShiftCooldown-Dt);
    if (!Reverse && ShiftCooldown<=0)
    {
        if (EngineRpm>5900 && Gear<Tuning->GearRatios.Num()) { ++Gear; ShiftCooldown=.3f; }
        else if (EngineRpm<1900 && Gear>1) { --Gear; ShiftCooldown=.3f; }
    }
    const float Torque = Tuning->TorqueNm.GetRichCurveConst()->Eval(EngineRpm)*EngineHealth;
    const float DriveForce = Drive*Torque*Ratio*Tuning->FinalDrive*Tuning->DrivetrainEfficiency/Tuning->RadiusM;
    const float MaxSteer = FMath::Lerp(Tuning->MaxSteerDegrees,9.f,FMath::Clamp(FMath::Abs(ForwardSpeed)/45.f,0.f,1.f));
    SmoothedSteer=FMath::FInterpTo(SmoothedSteer,SteeringInput*MaxSteer,Dt,7.f);
    float Wetness=0;
    for (TActorIterator<ACityWorld> It(GetWorld());It;++It) { Wetness=It->Wetness; break; }
    const float BaseMu=FMath::Lerp(Tuning->DryGrip,Tuning->WetGrip,Wetness);
    const float StaticLoad=Tuning->MassKg*9.81f/4.f;
    const FTransform BodyTransform=Chassis->GetComponentTransform();
    FCollisionQueryParams Query(SCENE_QUERY_STAT(CityWheel),true,this);
    for (int32 I=0;I<4;++I)
    {
        FCityWheelTelemetry& Wheel=Wheels[I]; Wheel=FCityWheelTelemetry();
        const FVector Start=BodyTransform.TransformPosition(Attachments[I]);
        const float MaxRay=(Tuning->RestLengthM+Tuning->DroopTravelM+Tuning->RadiusM)*100;
        FHitResult Hit;
        Wheel.Grounded=GetWorld()->LineTraceSingleByChannel(Hit,Start,Start-Up*MaxRay,ECC_Visibility,Query);
        float Length=Tuning->RestLengthM+Tuning->DroopTravelM;
        const float Steer=(I<2 ? SmoothedSteer : 0)+WheelAlignmentDegrees*(I%2==0 ? 1.f : .35f);
        if (Wheel.Grounded && FVector::DotProduct(Hit.ImpactNormal,Up)>.15f)
        {
            Length=FMath::Clamp(Hit.Distance/100.f-Tuning->RadiusM,Tuning->RestLengthM-Tuning->BumpTravelM,Tuning->RestLengthM+Tuning->DroopTravelM);
            Wheel.CompressionM=Tuning->RestLengthM-Length;
            const FVector ContactVelocity=Chassis->GetPhysicsLinearVelocityAtPoint(Hit.ImpactPoint)/100.f;
            const float SpringVelocity=FVector::DotProduct(ContactVelocity,Up);
            const float BumpStop=FMath::Max(0.f,Wheel.CompressionM-Tuning->BumpTravelM*.85f)*180000;
            Wheel.LoadN=FMath::Clamp(Wheel.CompressionM*Tuning->SpringNPerM-SpringVelocity*Tuning->DamperNsPerM+BumpStop,0.f,StaticLoad*6.f);
            const FVector ContactForward=FVector::VectorPlaneProject(Forward.RotateAngleAxis(Steer,Up),Hit.ImpactNormal).GetSafeNormal();
            const FVector Right=FVector::CrossProduct(Hit.ImpactNormal,ContactForward).GetSafeNormal();
            const float LongSpeed=FVector::DotProduct(ContactVelocity,ContactForward);
            const float LateralSpeed=FVector::DotProduct(ContactVelocity,Right);
            float Surface=1.f;
            if (Hit.Component.IsValid())
            {
                if (Hit.Component->ComponentHasTag("Track")) Surface=FMath::Lerp(.62f,.32f,Wetness);
                else if (Hit.Component->ComponentHasTag("Paint")) Surface=FMath::Lerp(.90f,.48f,Wetness);
                else if (Hit.Component->ComponentHasTag("Cobble")) Surface=.78f;
                else if (Hit.Component->ComponentHasTag("Terrain")) Surface=.50f;
            }
            // Modest tire load sensitivity: twice the load yields less than twice the grip.
            const float Mu=BaseMu*Surface*FMath::Pow(FMath::Max(.25f,Wheel.LoadN/StaticLoad),-.08f);
            Wheel.SurfaceGrip=Mu;
            const float Capacity=FMath::Max(1.f,Mu*Wheel.LoadN);
            const float SlipAngle=FMath::Atan2(LateralSpeed,FMath::Abs(LongSpeed)+1.5f);
            Wheel.SlipAngleDegrees=FMath::RadiansToDegrees(SlipAngle);
            const float WheelBrake=(Brake*(I<2 ? .32f : .18f)+(bHandbrake && I>=2 ? .5f : 0))*Tuning->BrakeForceN;
            // The velocity-limited brake demand prevents a stopped wheel from accelerating backwards.
            float BrakeForce=FMath::Sign(LongSpeed)*FMath::Min(WheelBrake,FMath::Abs(LongSpeed)*Tuning->MassKg/(4*Dt));
            if (FMath::Abs(LongSpeed)<.2f && WheelBrake>0)
                BrakeForce+=FMath::Clamp(static_cast<float>(FVector::DotProduct(FVector(0,0,-9.81f),ContactForward))*Tuning->MassKg/4.f,-WheelBrake,WheelBrake);
            const float Demand=(I>=2 ? DriveForce*.5f : 0)-BrakeForce-FMath::Sign(LongSpeed)*Wheel.LoadN*.014f;
            // Quasi-steady longitudinal slip curve. Rotational tire inertia is not simulated.
            Wheel.LongitudinalSlip=Demand/(Capacity*Tuning->LongitudinalSlipStiffness);
            float Fx=Capacity*std::tanh(Tuning->LongitudinalSlipStiffness*Wheel.LongitudinalSlip);
            float Fy=-Capacity*std::tanh(Tuning->LateralSlipStiffness*SlipAngle);
            const float Usage=FMath::Sqrt(Fx*Fx+Fy*Fy)/Capacity;
            if (Usage>1) { Fx/=Usage; Fy/=Usage; }
            // SI Newtons -> kg*cm/s². The offset contact forces cause physical roll/pitch load transfer.
            Chassis->AddForceAtLocation((Hit.ImpactNormal*Wheel.LoadN+ContactForward*Fx+Right*Fy)*100.f,Hit.ImpactPoint);
        }
        else Wheel.Grounded=false;
        WheelSpin[I]+=FMath::RadiansToDegrees(ForwardSpeed/FMath::Max(.1f,Tuning->RadiusM)*Dt);
        WheelVisuals[I]->SetRelativeLocation(Attachments[I]-FVector(0,0,Length*100));
        WheelVisuals[I]->SetRelativeRotation((FQuat(FVector::UpVector,FMath::DegreesToRadians(Steer))*FQuat(FVector::RightVector,FMath::DegreesToRadians(WheelSpin[I]))*FQuat(FVector::ForwardVector,PI/2)).Rotator());
    }
    const FVector Aero=-.5f*1.225f*Tuning->DragAreaM2*VelocityM.Size()*VelocityM;
    Chassis->AddForce(Aero*100.f);
}

void ACityVehicle::OnChassisHit(UPrimitiveComponent*,AActor*,UPrimitiveComponent*,FVector Impulse,const FHitResult& Hit)
{
    if (!Tuning) return;
    const float ImpactDeltaV=Impulse.Size()/(100*Tuning->MassKg);
    if (ImpactDeltaV<2.5f) return;
    const FVector Local=GetActorTransform().InverseTransformPosition(Hit.ImpactPoint);
    const float Damage=FMath::Clamp((ImpactDeltaV-2.5f)*.025f,0.f,.35f);
    EngineHealth=FMath::Clamp(EngineHealth-Damage*(Local.X>50 ? 1.f : .2f),.2f,1.f);
    WheelAlignmentDegrees=FMath::Clamp(WheelAlignmentDegrees+FMath::Sign(static_cast<float>(Local.Y))*Damage*9.f,-6.f,6.f);
    // A visible coarse deformation of the blockout body; production panels use the Blueprint event.
    BodyVisual->SetRelativeScale3D(FVector(4.10*(.9+.1*EngineHealth),1.78,.60));
    OnDamageChanged(EngineHealth,WheelAlignmentDegrees,Hit.ImpactPoint);
}

void ACityVehicle::SetResetTransform(const FTransform& Transform) { ResetTransform=Transform; }
void ACityVehicle::ResetVehicle()
{
    if (bPhotoMode) TogglePhotoMode();
    SetActorTransform(ResetTransform,false,nullptr,ETeleportType::TeleportPhysics);
    Chassis->SetPhysicsLinearVelocity(FVector::ZeroVector); Chassis->SetPhysicsAngularVelocityInDegrees(FVector::ZeroVector);
    ThrottleInput=0; BrakeInput=0; SteeringInput=0; Gear=1;
}
void ACityVehicle::RepairVehicle()
{
    EngineHealth=1; WheelAlignmentDegrees=0; BodyVisual->SetRelativeScale3D(FVector(4.10,1.78,.60));
    OnDamageChanged(1,0,GetActorLocation());
}
void ACityVehicle::CycleCamera() { CameraMode=(CameraMode+1)%3; UpdateCamera(); }
void ACityVehicle::LookYaw(float Value) { if (CameraMode==2 || bPhotoMode) OrbitYaw+=Value*1.6f; }
void ACityVehicle::LookPitch(float Value) { if (CameraMode==2 || bPhotoMode) OrbitPitch=FMath::Clamp(OrbitPitch+Value,-75.f,20.f); }
void ACityVehicle::UpdateCamera()
{
    const bool Cockpit=CameraMode==1 && !bPhotoMode;
    const bool Orbit=CameraMode==2 || bPhotoMode;
    SpringArm->TargetArmLength=Cockpit ? 0 : (Orbit ? 950 : 680);
    SpringArm->SetRelativeLocation(Cockpit ? FVector(23,-34,70) : FVector(0,0,100));
    SpringArm->SetRelativeRotation(Cockpit ? FRotator::ZeroRotator : FRotator(Orbit ? OrbitPitch : -14,Orbit ? OrbitYaw : 0,0));
    SpringArm->bInheritPitch=Cockpit; SpringArm->bInheritRoll=Cockpit;
    SpringArm->bEnableCameraLag=!Cockpit;
    Camera->FieldOfView=Cockpit ? 86 : (Orbit ? 55 : 78);
    Camera->PostProcessSettings.bOverride_MotionBlurAmount=true;
    Camera->PostProcessSettings.MotionBlurAmount=bPhotoMode ? 0 : .25f;
    Camera->PostProcessSettings.bOverride_DepthOfFieldFocalDistance=true;
    Camera->PostProcessSettings.DepthOfFieldFocalDistance=Orbit ? 950 : 100000;
    // The blockout cabin is solid; hide it for a usable cockpit view.
    TArray<UStaticMeshComponent*> Meshes; GetComponents(Meshes);
    for (UStaticMeshComponent* Mesh:Meshes) if (Mesh->GetName()==TEXT("CabinVisual")) Mesh->SetVisibility(!Cockpit);
}
void ACityVehicle::ToggleHeadlights() { bHeadlights=!bHeadlights; for (auto Light:Headlights) Light->SetVisibility(bHeadlights); }
void ACityVehicle::CycleWeather() { for (TActorIterator<ACityWorld> It(GetWorld());It;++It) It->CycleWeather(); }
void ACityVehicle::CycleTime() { for (TActorIterator<ACityWorld> It(GetWorld());It;++It) It->SetTimeOfDay(FMath::Fmod(It->TimeOfDay+4,24)); }
void ACityVehicle::TogglePhotoMode()
{
    bPhotoMode=!bPhotoMode;
    // Freezes this vehicle for framing without globally pausing input or camera controls.
    Chassis->SetSimulatePhysics(!bPhotoMode);
    if (bPhotoMode) ThrottleInput=0;
}
void ACityVehicle::Screenshot() { if (APlayerController* PC=Cast<APlayerController>(Controller)) PC->ConsoleCommand(TEXT("HighResShot 2")); }
