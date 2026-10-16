#include <pandoeditor/polygonmesh.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <emscripten.h>
#include <stdexcept>

namespace {
using emscripten::val;
using emscripten::EM_VAL;
// Bulk copies at the boundary avoid an emval crossing for every coordinate.
EM_JS(EM_VAL, packFillPolygon, (EM_VAL input), {
    const polygon=Emval.toValue(input),offsets=[0],points=[];
    const fail=message=>{const error=new Error(message);error.code='PL-MESH-TRIANGULATION';throw error;};
    if(!Array.isArray(polygon))fail('Polygon rings are required');
    for(const ring of polygon){
        if(!Array.isArray(ring))fail('Polygon ring is required');
        for(const point of ring){
            if(!Array.isArray(point)||point.length<2||!Number.isFinite(point[0])||!Number.isFinite(point[1]))fail('Invalid polygon coordinate');
            points.push(point[0],point[1]);
        }
        offsets.push(points.length/2);
    }
    return Emval.toHandle([offsets,points]);
});
EM_JS(EM_VAL, unpackFillMesh, (EM_VAL geographic,EM_VAL parameter,EM_VAL triangles,
    EM_VAL removed,EM_VAL offsets,EM_VAL vertices,EM_VAL visible,int pole), {
    const points=view=>{const input=Emval.toValue(view),result=[];
        for(let i=0;i<input.length;i+=2)result.push([input[i],input[i+1]]);return result;};
    const flat=view=>Array.from(Emval.toValue(view));
    const chainOffsets=Emval.toValue(offsets),indices=Emval.toValue(vertices),visibility=Emval.toValue(visible),chains=[];
    for(let r=1;r<chainOffsets.length;r++)chains.push({
        vertices:Array.from(indices.subarray(chainOffsets[r-1],chainOffsets[r])),
        visible:Array.from(visibility.subarray(chainOffsets[r-1],chainOffsets[r]),Boolean),
    });
    const discarded=flat(removed),removedTriangles=[];
    for(let i=0;i<discarded.length;i+=3)removedTriangles.push(discarded.slice(i,i+3));
    return Emval.toHandle({geographic:points(geographic),parameter:points(parameter),
        triangles:flat(triangles),removedTriangles,boundaryChains:chains,pole});
});
template<class T> val view(const std::vector<T>& values) {
    return val(emscripten::typed_memory_view(values.size(),values.data()));
}
val buildFillMesh(val input,double maxEdgeDegrees,bool validate,val cancellation) {
    try {
        const auto packed=val::take_ownership(packFillPolygon(input.as_handle()));
        const auto offsetValue=packed[0],pointValue=packed[1];
        std::vector<unsigned> offsets(offsetValue["length"].as<unsigned>());
        std::vector<double> points(pointValue["length"].as<unsigned>());
        view(offsets).call<void>("set",offsetValue);view(points).call<void>("set",pointValue);
        pandoeditor::Polygon polygon;
        for(std::size_t r=1;r<offsets.size();++r){
            auto& ring=polygon.emplace_back();ring.reserve(offsets[r]-offsets[r-1]);
            for(auto i=offsets[r-1];i<offsets[r];++i)ring.push_back({points[i*2],points[i*2+1]});
        }
        const std::function<void()> checkCancelled=cancellation.typeOf().as<std::string>()=="function"
            ?std::function<void()>([&]{cancellation();}):std::function<void()>{};
        const auto mesh=pandoeditor::buildPolygonFillMesh(polygon,maxEdgeDegrees,validate,checkCancelled);
        std::vector<double> geo,parameter;
        std::vector<std::uint32_t> triangles,removed,chainOffsets{0},vertices;
        std::vector<std::uint8_t> visible;
        for(const auto& p:mesh.geographic)geo.insert(geo.end(),p.begin(),p.end());
        for(const auto& p:mesh.parameter)parameter.insert(parameter.end(),p.begin(),p.end());
        for(const auto& t:mesh.triangles)triangles.insert(triangles.end(),t.begin(),t.end());
        for(const auto& t:mesh.removedTriangles)removed.insert(removed.end(),t.begin(),t.end());
        for(const auto& chain:mesh.boundaryChains){
            vertices.insert(vertices.end(),chain.vertices.begin(),chain.vertices.end());
            visible.insert(visible.end(),chain.visible.begin(),chain.visible.end());
            chainOffsets.push_back(static_cast<std::uint32_t>(vertices.size()));
        }
        return val::take_ownership(unpackFillMesh(view(geo).as_handle(),view(parameter).as_handle(),
            view(triangles).as_handle(),view(removed).as_handle(),view(chainOffsets).as_handle(),
            view(vertices).as_handle(),view(visible).as_handle(),mesh.space.pole));
    }catch(const std::exception& error){
        auto js=val::global("Error").new_(std::string("GPU 삼각분할 실패: ")+error.what());
        js.set("code",std::string("PL-MESH-TRIANGULATION"));js.throw_();
    }
    std::terminate();
}
}
EMSCRIPTEN_BINDINGS(pandoeditor_polygon_mesh) {
    emscripten::function("polygonBuildFillMesh",&buildFillMesh);
    emscripten::constant("polygonMeshAlgorithmRevision",pandoeditor::kPolygonMeshAlgorithmRevision);
}
