#include "CityWorld.h"
#include "ProceduralMeshComponent.h"
#include "KismetProceduralMeshLibrary.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/Material.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "UObject/ConstructorHelpers.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Algo/Reverse.h"
#include <cfloat>

namespace CityGeometry
{
struct FMesh
{
    TArray<FVector> V;
    TArray<int32> T;
    TArray<FVector2D> UV;
    TArray<FLinearColor> C;
    void Triangle(FVector A,FVector B,FVector D,FLinearColor Color,FVector2D U0=FVector2D(0,0),FVector2D U1=FVector2D(1,0),FVector2D U2=FVector2D(0,1))
    {
        const int32 Base=V.Num(); V.Append({A,B,D}); T.Append({Base,Base+1,Base+2});
        UV.Append({U0,U1,U2}); C.Append({Color,Color,Color});
    }
    void Quad(FVector A,FVector B,FVector C0,FVector D,FLinearColor Color,float WidthUv=1,float HeightUv=1)
    {
        Triangle(A,B,C0,Color,{0,0},{WidthUv,0},{WidthUv,HeightUv});
        Triangle(A,C0,D,Color,{0,0},{WidthUv,HeightUv},{0,HeightUv});
    }
    void UpTriangle(FVector A,FVector B,FVector D,FLinearColor Color)
    {
        if (FVector::CrossProduct(B-A,D-A).Z<0) Swap(B,D);
        Triangle(A,B,D,Color,FVector2D(A.X,A.Y)/300,FVector2D(B.X,B.Y)/300,FVector2D(D.X,D.Y)/300);
    }
    void Upload(UProceduralMeshComponent* Component,UMaterialInterface* Material,bool Collision=true)
    {
        Component->ClearAllMeshSections();
        if (V.Num()==0) return;
        TArray<FVector> N; TArray<FProcMeshTangent> Tangents;
        UKismetProceduralMeshLibrary::CalculateTangentsForMesh(V,T,UV,N,Tangents);
        Component->CreateMeshSection_LinearColor(0,V,T,N,UV,C,Tangents,Collision);
        if (Material) Component->SetMaterial(0,Material);
    }
};

static bool Point(const TSharedPtr<FJsonValue>& Value,FVector& Out)
{
    if (!Value.IsValid() || Value->Type!=EJson::Array) return false;
    const auto& A=Value->AsArray(); if (A.Num()<3) return false;
    for (int32 I=0;I<3;++I) if (A[I]->Type!=EJson::Number || !FMath::IsFinite(A[I]->AsNumber())) return false;
    Out=FVector(A[1]->AsNumber(),A[0]->AsNumber(),A[2]->AsNumber())*100.; return true;
}
static FString Id(const TSharedPtr<FJsonValue>& Value)
{
    if (!Value.IsValid()) return FString();
    if (Value->Type==EJson::String) return Value->AsString();
    if (Value->Type==EJson::Number) return FString::Printf(TEXT("%.0f"),Value->AsNumber());
    return FString();
}
static double Number(const TSharedPtr<FJsonObject>& O,const FString& Key,double Default)
{
    double Value; return O->TryGetNumberField(Key,Value) && FMath::IsFinite(Value) ? Value : Default;
}
static FString String(const TSharedPtr<FJsonObject>& O,const FString& Key,const FString& Default=TEXT(""))
{
    FString Value; return O->TryGetStringField(Key,Value) ? Value : Default;
}
static double Cross2D(const FVector& A,const FVector& B,const FVector& C)
{ return (B.X-A.X)*(C.Y-A.Y)-(B.Y-A.Y)*(C.X-A.X); }

// Ear clipping preserves concave OSM footprints; a fan would cap across courtyards/recesses.
static bool Triangulate(const TArray<FVector>& Polygon,TArray<int32>& Result)
{
    if (Polygon.Num()<3) return false;
    TArray<int32> Indices;
    double Area=0;
    for (int32 I=0;I<Polygon.Num();++I) { Indices.Add(I); const FVector& A=Polygon[I]; const FVector& B=Polygon[(I+1)%Polygon.Num()]; Area+=A.X*B.Y-B.X*A.Y; }
    if (Area<0) Algo::Reverse(Indices);
    int32 Budget=Polygon.Num()*Polygon.Num();
    while (Indices.Num()>3 && --Budget>0)
    {
        bool Clipped=false;
        for (int32 I=0;I<Indices.Num();++I)
        {
            const int32 A=Indices[(I+Indices.Num()-1)%Indices.Num()], B=Indices[I], C=Indices[(I+1)%Indices.Num()];
            if (Cross2D(Polygon[A],Polygon[B],Polygon[C])<.01) continue;
            bool Contains=false;
            for (int32 P:Indices)
            {
                if (P==A || P==B || P==C) continue;
                if (Cross2D(Polygon[A],Polygon[B],Polygon[P])>=0 && Cross2D(Polygon[B],Polygon[C],Polygon[P])>=0 && Cross2D(Polygon[C],Polygon[A],Polygon[P])>=0) { Contains=true; break; }
            }
            if (Contains) continue;
            Result.Append({A,B,C}); Indices.RemoveAt(I); Clipped=true; break;
        }
        if (!Clipped) return false;
    }
    if (Indices.Num()==3) Result.Append(Indices);
    return Result.Num()>=3;
}
}

ACityWorld::ACityWorld()
{
    PrimaryActorTick.bCanEverTick=true;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
    TerrainMesh=CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Terrain"));
    RoadMesh=CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Roads"));
    CobbleMesh=CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Cobbles"));
    PaintMesh=CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("RoadPaint"));
    TrackMesh=CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("CableCarTracks"));
    BuildingMesh=CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Buildings"));
    for (auto Mesh:{TerrainMesh.Get(),RoadMesh.Get(),CobbleMesh.Get(),PaintMesh.Get(),TrackMesh.Get(),BuildingMesh.Get()})
    {
        Mesh->SetupAttachment(RootComponent); Mesh->SetCollisionProfileName(TEXT("BlockAll"));
        Mesh->bUseComplexAsSimpleCollision=true;
        // Synchronous collision cooking ensures the car never spawns before the road is solid.
        Mesh->bUseAsyncCooking=false;
        Mesh->SetCastShadow(true);
    }
    TerrainMesh->ComponentTags.Add(TEXT("Terrain"));
    CobbleMesh->ComponentTags.Add(TEXT("Cobble"));
    PaintMesh->ComponentTags.Add(TEXT("Paint"));
    TrackMesh->ComponentTags.Add(TEXT("Track"));
    Sun=CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun")); Sun->SetupAttachment(RootComponent);
    Sun->SetMobility(EComponentMobility::Movable); Sun->bAtmosphereSunLight=true; Sun->SetIntensity(80000);
    SkyLight=CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight")); SkyLight->SetupAttachment(RootComponent);
    SkyLight->SetMobility(EComponentMobility::Movable); SkyLight->bRealTimeCapture=true;
    Atmosphere=CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("SkyAtmosphere")); Atmosphere->SetupAttachment(RootComponent);
    Fog=CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("BayFog")); Fog->SetupAttachment(RootComponent);
    Fog->SetVolumetricFog(true); Fog->SetFogDensity(.005f); Fog->SetFogHeightFalloff(.14f); Fog->SetVolumetricFogDistance(100000);
    RainStreaks=CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Rain")); RainStreaks->SetupAttachment(RootComponent);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    RainStreaks->SetStaticMesh(Cube.Object); RainStreaks->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RainStreaks->SetCastShadow(false);
}

void ACityWorld::BeginPlay()
{
    Super::BeginPlay();
    LoadCity();
    FRandomStream Random(1937);
    RainStreaks->ClearInstances(); RainOffsets.Empty();
    for (int32 I=0;I<220;++I)
    {
        FVector P(Random.FRandRange(-1900,1900),Random.FRandRange(-1900,1900),Random.FRandRange(0,2200));
        RainOffsets.Add(P); RainStreaks->AddInstance(FTransform(FRotator(0,0,8),P,FVector(.012,.012,.8)));
    }
    if (RainMaterial) RainStreaks->SetMaterial(0,RainMaterial);
    RainStreaks->SetVisibility(false); UpdateEnvironment(0);
}

bool ACityWorld::LoadCity()
{
    using namespace CityGeometry;
    bCityLoaded=false; LastLoadError.Empty();
    FString Path=CityFileOverride;
    if (Path.IsEmpty())
    {
        Path=FPaths::ProjectContentDir()/TEXT("CityData")/CityPackage/TEXT("city.json");
        if (!FPaths::FileExists(Path)) Path=FPaths::ProjectDir()/TEXT("../data/cities")/CityPackage/TEXT("city.json");
    }
    FString Text;
    TSharedPtr<FJsonObject> Root;
    auto Fail=[this](const FString& Reason) { LastLoadError=Reason; UE_LOG(LogTemp,Error,TEXT("City Wheels: %s"),*Reason); return false; };
    if (!FFileHelper::LoadFileToString(Text,*Path)) return Fail(FString::Printf(TEXT("Cannot read city package: %s"),*Path));
    if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text),Root) || !Root.IsValid()) return Fail(TEXT("Invalid city JSON"));
    if (Number(Root,"schemaVersion",0)!=1) return Fail(TEXT("Unsupported city schemaVersion; expected 1"));
    const TSharedPtr<FJsonObject>* Terrain=nullptr;
    if (!Root->TryGetObjectField(TEXT("terrain"),Terrain)) return Fail(TEXT("Missing terrain"));
    const int32 Width=Number(*Terrain,"width",0), Height=Number(*Terrain,"height",0);
    const double Cell=Number(*Terrain,"cellSize",0);
    const TArray<TSharedPtr<FJsonValue>>* Heights=nullptr;
    if (Width<2 || Height<2 || Width>2048 || Height>2048 || Cell<=0 || !(*Terrain)->TryGetArrayField("heights",Heights) || Heights->Num()!=Width*Height)
        return Fail(TEXT("Invalid terrain dimensions/heights"));
    const TArray<TSharedPtr<FJsonValue>>* RoadArray=nullptr;
    const TArray<TSharedPtr<FJsonValue>>* BuildingArray=nullptr;
    if (!Root->TryGetArrayField("roads",RoadArray) || !Root->TryGetArrayField("buildings",BuildingArray)) return Fail(TEXT("Missing roads/buildings arrays"));
    CityDisplayName=String(Root,"name",CityPackage);
    double XMin=-(Width-1)*Cell/2, YMin=-(Height-1)*Cell/2;
    const TSharedPtr<FJsonObject>* Bounds=nullptr;
    if (Root->TryGetObjectField("bounds",Bounds)) { XMin=Number(*Bounds,"minX",XMin); YMin=Number(*Bounds,"minY",YMin); }
    FMesh TerrainData,RoadData,CobbleData,PaintData,TrackData,BuildingData;
    TArray<double> TerrainZ; TerrainZ.Reserve(Width*Height);
    for (const auto& H:*Heights)
    {
        if (H->Type!=EJson::Number || !FMath::IsFinite(H->AsNumber())) return Fail(TEXT("Non-finite terrain sample"));
        TerrainZ.Add(H->AsNumber()*100);
    }
    Roads.Empty();
    struct FJunction { FVector Position=FVector::ZeroVector; float Radius=0; int32 Occurrences=0; };
    TMap<FString,FJunction> Junctions;
    for (const auto& Value:*RoadArray)
    {
        if (Value->Type!=EJson::Object) continue;
        const auto O=Value->AsObject(); FCityRoad Road;
        if (O->HasField("id")) Road.Id=Id(O->Values["id"]);
        Road.Name=String(O,"name",TEXT("Unnamed street")); Road.Surface=String(O,"surface",TEXT("asphalt"));
        Road.WidthCm=FMath::Clamp(Number(O,"width",7)*100,150.,3000.);
        Road.SpeedKph=Number(O,"speedKph",40); Road.Lanes=Number(O,"lanes",2); Road.OneWay=Number(O,"oneway",0);
        const TArray<TSharedPtr<FJsonValue>>* Points=nullptr;
        if (!O->TryGetArrayField("points",Points)) continue;
        for (const auto& P:*Points) { FVector PointValue; if (Point(P,PointValue)) Road.Points.Add(PointValue+FVector(0,0,14)); }
        if (Road.Points.Num()<2) continue;
        const TArray<TSharedPtr<FJsonValue>>* Nodes=nullptr;
        if (O->TryGetArrayField("nodeIds",Nodes)) for (const auto& Node:*Nodes) Road.NodeIds.Add(Id(Node));
        FMesh& RoadTarget=Road.Surface.Contains("cobbl") || Road.Surface.Contains("sett") || Road.Surface=="bricks" || Road.Surface=="paving_stones" ? CobbleData : RoadData;
        TArray<FVector> Left,Right;
        for (int32 I=0;I<Road.Points.Num();++I)
        {
            FVector Prev=(Road.Points[I]-Road.Points[FMath::Max(0,I-1)]).GetSafeNormal2D();
            FVector Next=(Road.Points[FMath::Min(I+1,Road.Points.Num()-1)]-Road.Points[I]).GetSafeNormal2D();
            if (Prev.IsNearlyZero()) Prev=Next; if (Next.IsNearlyZero()) Next=Prev;
            FVector Side=FVector::CrossProduct(FVector::UpVector,(Prev+Next).GetSafeNormal2D());
            if (Side.IsNearlyZero()) Side=FVector::CrossProduct(FVector::UpVector,Next);
            const double Miter=FMath::Min(2.,1./FMath::Max(.5,FMath::Abs(FVector::DotProduct(Side,FVector::CrossProduct(FVector::UpVector,Next)))));
            Left.Add(Road.Points[I]-Side*Road.WidthCm*.5*Miter); Right.Add(Road.Points[I]+Side*Road.WidthCm*.5*Miter);
            if (I<Road.NodeIds.Num() && !Road.NodeIds[I].IsEmpty())
            {
                FJunction& J=Junctions.FindOrAdd(Road.NodeIds[I]); J.Position=Road.Points[I]; J.Radius=FMath::Max(J.Radius,Road.WidthCm*.5f); ++J.Occurrences;
            }
        }
        float DistanceAlong=0;
        for (int32 I=0;I<Road.Points.Num()-1;++I)
        {
            RoadTarget.UpTriangle(Left[I],Right[I],Right[I+1],FLinearColor(.065,.070,.075));
            RoadTarget.UpTriangle(Left[I],Right[I+1],Left[I+1],FLinearColor(.065,.070,.075));
            // Sparse lane centre marks; one-way direction remains stored in FCityRoad for routing.
            if (Road.Lanes<2 || Road.OneWay!=0) continue;
            const FVector A=Road.Points[I]+FVector(0,0,1.5), B=Road.Points[I+1]+FVector(0,0,1.5);
            const FVector Delta=B-A, Side=FVector::CrossProduct(FVector::UpVector,Delta.GetSafeNormal2D())*6;
            const float Distance=Delta.Size();
            for (float S=0;S<Distance-.01f;)
            {
                const float Phase=FMath::Fmod(DistanceAlong+S,850.f);
                const bool Mark=Phase<300;
                const float Step=FMath::Max(.01f,FMath::Min(Distance-S,(Mark ? 300.f : 850.f)-Phase));
                if (Mark)
                {
                    const FVector P=A+Delta*(S/Distance), Q=A+Delta*((S+Step)/Distance);
                    PaintData.UpTriangle(P-Side,P+Side,Q+Side,FLinearColor(.95,.65,.15));
                    PaintData.UpTriangle(P-Side,Q+Side,Q-Side,FLinearColor(.95,.65,.15));
                }
                S+=Step;
            }
            DistanceAlong+=Distance;
        }
        Roads.Add(MoveTemp(Road));
    }
    // Cut the rendered DEM beneath each engineered road corridor. Original source heights and
    // centreline grades remain intact in the JSON; this stops uphill terrain crossing the deck.
    for (const FCityRoad& Road:Roads) for (int32 I=0;I+1<Road.Points.Num();++I)
    {
        const FVector A=Road.Points[I], B=Road.Points[I+1], D=B-A;
        const double Pad=Road.WidthCm*.5+Cell*100*1.5;
        const int32 MinX=FMath::Clamp(FMath::FloorToInt((FMath::Min(A.Y,B.Y)-Pad)/100/Cell-XMin/Cell),0,Width-1);
        const int32 MaxX=FMath::Clamp(FMath::CeilToInt((FMath::Max(A.Y,B.Y)+Pad)/100/Cell-XMin/Cell),0,Width-1);
        const int32 MinY=FMath::Clamp(FMath::FloorToInt((FMath::Min(A.X,B.X)-Pad)/100/Cell-YMin/Cell),0,Height-1);
        const int32 MaxY=FMath::Clamp(FMath::CeilToInt((FMath::Max(A.X,B.X)+Pad)/100/Cell-YMin/Cell),0,Height-1);
        const double DSquared=D.X*D.X+D.Y*D.Y;
        if (DSquared<.1) continue;
        for (int32 Y=MinY;Y<=MaxY;++Y) for (int32 X=MinX;X<=MaxX;++X)
        {
            const FVector P((YMin+Y*Cell)*100,(XMin+X*Cell)*100,0);
            const double T=FMath::Clamp(((P.X-A.X)*D.X+(P.Y-A.Y)*D.Y)/DSquared,0.,1.);
            const FVector Near=A+D*T;
            const double Distance=FVector::Dist2D(P,Near);
            if (Distance>Pad) continue;
            const double Alpha=FMath::Clamp((Pad-Distance)/(Cell*100),0.,1.);
            const double Lowered=FMath::Lerp(TerrainZ[Y*Width+X],Near.Z-24,Alpha);
            TerrainZ[Y*Width+X]=FMath::Min(TerrainZ[Y*Width+X],Lowered);
        }
    }
    for (int32 Y=0;Y<Height;++Y) for (int32 X=0;X<Width;++X)
    {
        TerrainData.V.Add(FVector((YMin+Y*Cell)*100,(XMin+X*Cell)*100,TerrainZ[Y*Width+X]));
        TerrainData.UV.Add(FVector2D(X*Cell/3,Y*Cell/3)); TerrainData.C.Add(FLinearColor(.19,.23,.16));
    }
    for (int32 Y=0;Y<Height-1;++Y) for (int32 X=0;X<Width-1;++X)
    {
        const int32 A=Y*Width+X,B=A+1,C=A+Width+1,D=A+Width;
        TerrainData.T.Append({A,C,B,A,D,C});
    }
    // Fill the open wedges where road ribbons share an actual source node. No proximity snapping.
    for (const auto& Item:Junctions)
    {
        const FJunction& J=Item.Value; if (J.Occurrences<2) continue;
        for (int32 I=0;I<20;++I)
        {
            const float A=I*2*PI/20, B=(I+1)*2*PI/20;
            const FVector C=J.Position+FVector(0,0,.5);
            RoadData.UpTriangle(C,C+FVector(FMath::Cos(A),FMath::Sin(A),0)*J.Radius,C+FVector(FMath::Cos(B),FMath::Sin(B),0)*J.Radius,FLinearColor(.065,.070,.075));
        }
    }
    const TArray<TSharedPtr<FJsonValue>>* Rails=nullptr;
    if (Root->TryGetArrayField("railways",Rails)) for (const auto& Value:*Rails)
    {
        if (Value->Type!=EJson::Object) continue;
        const auto O=Value->AsObject(); const TArray<TSharedPtr<FJsonValue>>* Points=nullptr;
        if (!O->TryGetArrayField("points",Points)) continue;
        double GaugeCm=106.7;
        const TSharedPtr<FJsonObject>* Tags=nullptr;
        if (O->TryGetObjectField("tags",Tags))
        {
            const FString Gauge=String(*Tags,"gauge");
            if (Gauge.IsNumeric()) GaugeCm=FCString::Atod(*Gauge)/10;
        }
        for (int32 I=0;I+1<Points->Num();++I)
        {
            FVector A,B; if (!Point((*Points)[I],A) || !Point((*Points)[I+1],B)) continue;
            A.Z+=17; B.Z+=17;
            const FVector Side=FVector::CrossProduct(FVector::UpVector,(B-A).GetSafeNormal2D());
            for (float Sign:{-1.f,1.f})
            {
                const FVector Offset=Side*(Sign*GaugeCm*.5);
                TrackData.UpTriangle(A+Offset-Side*5,A+Offset+Side*5,B+Offset+Side*5,FLinearColor(.32,.35,.36));
                TrackData.UpTriangle(A+Offset-Side*5,B+Offset+Side*5,B+Offset-Side*5,FLinearColor(.32,.35,.36));
            }
        }
    }
    for (const auto& Value:*BuildingArray)
    {
        if (Value->Type!=EJson::Object) continue;
        const auto O=Value->AsObject(); const TArray<TSharedPtr<FJsonValue>>* Footprint=nullptr;
        if (!O->TryGetArrayField("footprint",Footprint)) continue;
        TArray<FVector> Polygon;
        for (const auto& P:*Footprint) { FVector V; if (Point(P,V) && (Polygon.IsEmpty() || !Polygon.Last().Equals(V,.5))) Polygon.Add(V); }
        if (Polygon.Num()>2 && Polygon[0].Equals(Polygon.Last(),.5)) Polygon.Pop();
        if (Polygon.Num()<3) continue;
        const float HeightCm=FMath::Clamp(Number(O,"height",9)*100,250.,35000.);
        double RoofZ=-DBL_MAX; for (const FVector& P:Polygon) RoofZ=FMath::Max(RoofZ,P.Z+HeightCm);
        const FString Style=String(O,"style",TEXT("pastel"));
        const uint32 Hash=GetTypeHash(String(O,"id",FString::FromInt(BuildingData.V.Num())));
        FLinearColor Color(.55,.52,.46);
        if (Style.Contains("victorian")) Color=FLinearColor(.58+(Hash%7)*.024,.47+(Hash%5)*.035,.39+(Hash%9)*.022);
        else if (Style.Contains("glass") || Style.Contains("modern")) Color=FLinearColor(.23,.36,.41);
        else Color=FLinearColor(.58+(Hash%5)*.04,.57+(Hash%7)*.025,.49+(Hash%9)*.03);
        double SignedArea=0;
        for (int32 I=0;I<Polygon.Num();++I) { const FVector& A=Polygon[I]; const FVector& B=Polygon[(I+1)%Polygon.Num()]; SignedArea+=A.X*B.Y-B.X*A.Y; }
        if (SignedArea<0) Algo::Reverse(Polygon);
        for (int32 I=0;I<Polygon.Num();++I)
        {
            const FVector A=Polygon[I],B=Polygon[(I+1)%Polygon.Num()],C(B.X,B.Y,RoofZ),D(A.X,A.Y,RoofZ);
            BuildingData.Quad(A,B,C,D,Color,FVector::Distance(A,B)/300,HeightCm/300);
        }
        TArray<int32> Triangles;
        if (Triangulate(Polygon,Triangles)) for (int32 I=0;I<Triangles.Num();I+=3)
        {
            FVector A=Polygon[Triangles[I]],B=Polygon[Triangles[I+1]],C=Polygon[Triangles[I+2]]; A.Z=B.Z=C.Z=RoofZ;
            BuildingData.UpTriangle(A,B,C,FLinearColor(.20,.21,.21));
        }
    }
    DynamicMaterials.Empty();
    auto Material=[this](UMaterialInterface* Base)->UMaterialInterface*
    {
        if (!Base) return UMaterial::GetDefaultMaterial(MD_Surface);
        UMaterialInstanceDynamic* MID=UMaterialInstanceDynamic::Create(Base,this); DynamicMaterials.Add(MID); return MID;
    };
    TerrainData.Upload(TerrainMesh,Material(SurfaceMaterial));
    RoadData.Upload(RoadMesh,Material(SurfaceMaterial));
    CobbleData.Upload(CobbleMesh,Material(SurfaceMaterial));
    PaintData.Upload(PaintMesh,Material(SurfaceMaterial));
    TrackData.Upload(TrackMesh,Material(SurfaceMaterial));
    BuildingData.Upload(BuildingMesh,Material(FacadeMaterial));
    const TSharedPtr<FJsonObject>* Spawn=nullptr;
    if (Root->TryGetObjectField("spawn",Spawn) && (*Spawn)->HasField("position"))
    {
        FVector Position;
        if (Point((*Spawn)->Values["position"],Position)) SpawnTransform=FTransform(FRotator(0,FMath::RadiansToDegrees(Number(*Spawn,"headingRadians",0)),0),Position+FVector(0,0,100));
    }
    for (auto Light:StreetLights) if (Light) Light->DestroyComponent(); StreetLights.Empty();
    int32 Index=0;
    for (const auto& Item:Junctions)
    {
        if (Item.Value.Occurrences<2 || Index>=70) continue;
        UPointLightComponent* Light=NewObject<UPointLightComponent>(this,*FString::Printf(TEXT("StreetLight%d"),Index++));
        Light->SetupAttachment(RootComponent); Light->SetRelativeLocation(Item.Value.Position+FVector(Item.Value.Radius+120,0,750));
        Light->SetIntensity(0); Light->SetAttenuationRadius(2400); Light->SetLightColor(FLinearColor(1,.76,.44));
        Light->SetCastShadows(false); Light->RegisterComponent(); StreetLights.Add(Light);
    }
    bCityLoaded=true;
    UE_LOG(LogTemp,Display,TEXT("City Wheels: loaded %s, %d roads, %d building records"),*CityDisplayName,Roads.Num(),BuildingArray->Num());
    OnCityLoaded(); UpdateEnvironment(0); return true;
}

void ACityWorld::Tick(float Dt)
{
    Super::Tick(Dt);
    if (bAnimateTime && DayLengthMinutes>0) TimeOfDay=FMath::Fmod(TimeOfDay+Dt*24/(DayLengthMinutes*60),24);
    Wetness=FMath::FInterpTo(Wetness,Weather==2 ? 1.f : 0.f,Dt,Weather==2 ? .12f : .035f);
    EnvironmentAccumulator+=Dt;
    if (EnvironmentAccumulator>=.1f) { UpdateEnvironment(EnvironmentAccumulator); EnvironmentAccumulator=0; }
    if (Weather==2 && RainOffsets.Num()>0)
    {
        RainTime+=Dt;
        FVector Center=UGameplayStatics::GetPlayerPawn(this,0) ? UGameplayStatics::GetPlayerPawn(this,0)->GetActorLocation() : FVector::ZeroVector;
        for (int32 I=0;I<RainOffsets.Num();++I)
        {
            FVector P=RainOffsets[I]; P.Z=FMath::Fmod(P.Z-RainTime*1800,2200); if (P.Z<0) P.Z+=2200;
            RainStreaks->UpdateInstanceTransform(I,FTransform(FRotator(0,0,8),Center+P,FVector(.012,.012,.8)),true,I==RainOffsets.Num()-1,true);
        }
    }
}

void ACityWorld::UpdateEnvironment(float Dt)
{
    const float SolarAngle=(TimeOfDay-6)/24*360;
    Sun->SetRelativeRotation(FRotator(-SolarAngle,125,0));
    const float Daylight=FMath::Max(0.f,FMath::Sin(FMath::DegreesToRadians(SolarAngle)));
    Sun->SetIntensity(FMath::Lerp(300.f,95000.f,Daylight)*(Weather==2 ? .28f : 1.f));
    Sun->SetLightColor(FMath::Lerp(FLinearColor(1,.49,.24),FLinearColor(1,.96,.87),FMath::Clamp(Daylight*3,0.f,1.f)));
    SkyLight->SetIntensity(FMath::Lerp(.16f,1.f,Daylight));
    const float FogDensity=Weather==1 ? .075f : (Weather==2 ? .035f : .004f);
    Fog->SetFogDensity(FMath::FInterpTo(Fog->FogDensity,FogDensity,Dt>0 ? Dt : 1.f,.6f));
    RainStreaks->SetVisibility(Weather==2);
    for (auto MID:DynamicMaterials) { MID->SetScalarParameterValue(TEXT("Wetness"),Wetness); MID->SetScalarParameterValue(TEXT("Night"),Daylight<.08f ? 1.f : 0.f); }
    for (auto Light:StreetLights) Light->SetIntensity(Daylight<.1f ? 9000 : 0);
}
void ACityWorld::CycleWeather() { Weather=(Weather+1)%3; UpdateEnvironment(.1f); }
void ACityWorld::SetTimeOfDay(float Hours) { TimeOfDay=FMath::Fmod(Hours+24,24); UpdateEnvironment(.1f); }
