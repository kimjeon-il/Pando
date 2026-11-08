configure_file("${PANDOEDITOR_REPOSITORY_ROOT}/src/runtime/native/src/version.cpp.in" generated/version.cpp @ONLY)
file(READ "${PANDOEDITOR_REPOSITORY_ROOT}/config/core-source-roots.json" pin_root_configuration)
string(JSON pin_root_count LENGTH "${pin_root_configuration}" roots)
math(EXPR pin_root_last "${pin_root_count}-1")
set(PANDOEDITOR_NATIVE_PIN_ROOTS "")
foreach(pin_root_index RANGE 0 ${pin_root_last})
    string(JSON pin_root GET "${pin_root_configuration}" roots ${pin_root_index})
    list(APPEND PANDOEDITOR_NATIVE_PIN_ROOTS "${PANDOEDITOR_REPOSITORY_ROOT}/${pin_root}")
endforeach()
set(PANDOEDITOR_CORE_PIN_INPUTS "${PANDOEDITOR_REPOSITORY_ROOT}/config/core-source-roots.json")
foreach(pin_root IN LISTS PANDOEDITOR_NATIVE_PIN_ROOTS)
    file(GLOB_RECURSE pin_files CONFIGURE_DEPENDS "${pin_root}/*.cpp" "${pin_root}/*.h" "${pin_root}/*.hpp" "${pin_root}/*.cpp.in" "${pin_root}/*.h.in" "${pin_root}/*.cmake" "${pin_root}/CMakeLists.txt")
    list(APPEND PANDOEDITOR_CORE_PIN_INPUTS ${pin_files})
endforeach()
list(SORT PANDOEDITOR_CORE_PIN_INPUTS)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${PANDOEDITOR_CORE_PIN_INPUTS})
set(PANDOEDITOR_CORE_PIN_LINES "")
foreach(pin_input IN LISTS PANDOEDITOR_CORE_PIN_INPUTS)
    file(RELATIVE_PATH pin_path "${PANDOEDITOR_REPOSITORY_ROOT}" "${pin_input}")
    file(READ "${pin_input}" pin_contents)
    string(REPLACE "\r\n" "\n" pin_contents "${pin_contents}")
    string(SHA256 pin_hash "${pin_contents}")
    string(APPEND PANDOEDITOR_CORE_PIN_LINES "${pin_path}\n${pin_hash}\n")
endforeach()
string(SHA256 PANDOEDITOR_CORE_SOURCE_SHA256 "${PANDOEDITOR_CORE_PIN_LINES}")
set(PANDOEDITOR_CORE_SOURCE_SHA256 "${PANDOEDITOR_CORE_SOURCE_SHA256}" PARENT_SCOPE)
if(NOT EMSCRIPTEN)
    find_package(ZLIB REQUIRED)
endif()

add_library(pandoeditor_core STATIC
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/data/native/src/hydroformat.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/hydroviewport.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/project.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/presentation.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/presentationcommands.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/document.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/geometryprovenance.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/temporal.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/placenames.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/timeline-records.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/timeline-resolver.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/timeline-view.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/timeline-edit.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/timeline-storage.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/data/native/src/losslessjson.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/data/native/src/projectcodec.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/data/native/src/webstorage.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/document-session.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/geometrydraft.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/historicallibrary.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/historicalinstantiation.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/gisexchange.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/data/native/src/geopackagegeometry.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/data/native/src/giszip.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/content.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/objectproperties.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/geometrypredicates.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/polygonwrapping.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/polygonclipping.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/planargraph.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/riverpartition.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/cutgeometry.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/data/native/src/referenceimage.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/map/native/src/mapprojection.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/referencetracing.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/referenceboundaries.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/sphericalpolygon.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundarychain.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundarypacket.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundarycontact.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundaryoverlap.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/rendering/native/src/polygonmesh.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundaryrefinement.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundarysplit.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/countrycontact.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/territorialmutation.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/commands.cpp"
  "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/commandbatch.cpp"
  "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/webcommands.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/webcontentcommands.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/webpresentationcommands.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/webterritorialcommands.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/webterritorialedit.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/webobjectcommands.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/jobs.cpp"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/src/snapshot.cpp"
    "${CMAKE_CURRENT_BINARY_DIR}/generated/version.cpp"
)
add_library(Pandoeditor::Core ALIAS pandoeditor_core)

target_include_directories(pandoeditor_core PUBLIC
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/include"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/include"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/map/native/include"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/rendering/native/include"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/data/native/include"
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/runtime/native/include"
)
target_include_directories(pandoeditor_core PRIVATE
    "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/vendor/earcut")
target_compile_features(pandoeditor_core PUBLIC cxx_std_17)
if(MSVC)
    target_compile_options(pandoeditor_core PUBLIC /utf-8)
endif()
if(EMSCRIPTEN)
    target_compile_options(pandoeditor_core PUBLIC "-sUSE_ZLIB=1" -fwasm-exceptions)
    target_link_options(pandoeditor_core PUBLIC "-sUSE_ZLIB=1" -fwasm-exceptions)
else()
    target_link_libraries(pandoeditor_core PUBLIC ZLIB::ZLIB)
endif()
set_target_properties(pandoeditor_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(EMSCRIPTEN OR CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(pandoeditor_core PUBLIC
        "-ffile-prefix-map=${PANDOEDITOR_REPOSITORY_ROOT}=/pando"
        "-fdebug-prefix-map=${PANDOEDITOR_REPOSITORY_ROOT}=/pando")
endif()


# Match historical JS multiplication order for near-collinear source edges.
set_source_files_properties("${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/riverpartition.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/planargraph.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/polygonwrapping.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/polygonclipping.cpp" PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")
set_source_files_properties("${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/cutgeometry.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/data/native/src/referenceimage.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/referencetracing.cpp" PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")
set_source_files_properties("${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundarycontact.cpp" PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Source segment projections and gap coordinates match unfused JS double operations.
set_source_files_properties("${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundaryoverlap.cpp" PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# The projected stroke vertices must use the same intermediate rounding in
# all native compilers and the WASM target (no fused multiply-add).
set_source_files_properties("${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundaryrefinement.cpp" PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Preserve JS intermediate floating point steps for contact split ordering.
set_source_files_properties("${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundarysplit.cpp" PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Match V8's source-edge projections across native and WASM targets.
set_source_files_properties("${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/countrycontact.cpp" PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Owner-group chains, seam division, refinement and dash phase use the same
# strict intermediate double operations in Qt, GCC/Clang and Emscripten.
set_source_files_properties("${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/src/boundarypacket.cpp" PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Fill projection and shared-edge subdivision use identical double operations
# in Qt, GCC/Clang and Emscripten, including projected-area validation.
set_source_files_properties("${PANDOEDITOR_REPOSITORY_ROOT}/src/rendering/native/src/polygonmesh.cpp" PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")
