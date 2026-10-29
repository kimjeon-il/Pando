configure_file(src/version.cpp.in generated/version.cpp @ONLY)
# Deterministic pin shared by native and WASM builds and the packaging manifest.
# Hash the relative repository path and CRLF-normalized contents, with no clock,
# checkout path or generated build output in the digest.
get_filename_component(PANDOEDITOR_SHARED_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
get_filename_component(PANDOEDITOR_REPOSITORY_ROOT "${PANDOEDITOR_SHARED_ROOT}/.." ABSOLUTE)
file(GLOB_RECURSE PANDOEDITOR_CORE_PIN_INPUTS CONFIGURE_DEPENDS
    "${PANDOEDITOR_SHARED_ROOT}/*.cpp" "${PANDOEDITOR_SHARED_ROOT}/*.h" "${PANDOEDITOR_SHARED_ROOT}/*.hpp"
    "${PANDOEDITOR_SHARED_ROOT}/*.cpp.in" "${PANDOEDITOR_SHARED_ROOT}/*.h.in"
    "${PANDOEDITOR_SHARED_ROOT}/*.cmake" "${PANDOEDITOR_SHARED_ROOT}/CMakeLists.txt")
list(SORT PANDOEDITOR_CORE_PIN_INPUTS)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${PANDOEDITOR_CORE_PIN_INPUTS})
set(PANDOEDITOR_CORE_PIN_LINES "")
foreach(pin_input IN LISTS PANDOEDITOR_CORE_PIN_INPUTS)
    file(RELATIVE_PATH pin_path "${PANDOEDITOR_SHARED_ROOT}/.." "${pin_input}")
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
    src/hydroformat.cpp
    src/hydroviewport.cpp
    src/project.cpp
    src/presentation.cpp
    src/presentationcommands.cpp
    src/document.cpp
    src/geometryprovenance.cpp
    src/temporal.cpp
    src/placenames.cpp
    src/timeline-records.cpp
    src/timeline-resolver.cpp
    src/timeline-view.cpp
    src/timeline-edit.cpp
    src/timeline-storage.cpp
    src/losslessjson.cpp
    src/projectcodec.cpp
    src/webstorage.cpp
    src/document-session.cpp
    src/geometrydraft.cpp
    src/historicallibrary.cpp
    src/historicalinstantiation.cpp
    src/gisexchange.cpp
    src/geopackagegeometry.cpp
    src/giszip.cpp
    src/content.cpp
    src/objectproperties.cpp
    src/geometrypredicates.cpp
    src/polygonwrapping.cpp
    src/polygonclipping.cpp
    src/planargraph.cpp
    src/riverpartition.cpp
    src/cutgeometry.cpp
    src/referenceimage.cpp
    src/mapprojection.cpp
    src/referencetracing.cpp
    src/referenceboundaries.cpp
    src/sphericalpolygon.cpp
    src/boundarychain.cpp
    src/boundarypacket.cpp
    src/boundarycontact.cpp
    src/boundaryoverlap.cpp
    src/polygonmesh.cpp
    src/boundaryrefinement.cpp
    src/boundarysplit.cpp
    src/countrycontact.cpp
    src/territorialmutation.cpp
    src/commands.cpp
  src/commandbatch.cpp
  src/webcommands.cpp
    src/webcontentcommands.cpp
    src/webpresentationcommands.cpp
    src/webterritorialcommands.cpp
    src/webterritorialedit.cpp
    src/webobjectcommands.cpp
    src/jobs.cpp
    src/snapshot.cpp
    "${CMAKE_CURRENT_BINARY_DIR}/generated/version.cpp"
)
add_library(Pandoeditor::Core ALIAS pandoeditor_core)

target_include_directories(pandoeditor_core PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}/include"
)
target_include_directories(pandoeditor_core PRIVATE
    "${PANDOEDITOR_SHARED_ROOT}/third_party/earcut")
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
set_source_files_properties(src/riverpartition.cpp src/planargraph.cpp src/polygonwrapping.cpp src/polygonclipping.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")
set_source_files_properties(src/cutgeometry.cpp src/referenceimage.cpp src/referencetracing.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")
set_source_files_properties(src/boundarycontact.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Source segment projections and gap coordinates match unfused JS double operations.
set_source_files_properties(src/boundaryoverlap.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# The projected stroke vertices must use the same intermediate rounding in
# all native compilers and the WASM target (no fused multiply-add).
set_source_files_properties(src/boundaryrefinement.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Preserve JS intermediate floating point steps for contact split ordering.
set_source_files_properties(src/boundarysplit.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Match V8's source-edge projections across native and WASM targets.
set_source_files_properties(src/countrycontact.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Owner-group chains, seam division, refinement and dash phase use the same
# strict intermediate double operations in Qt, GCC/Clang and Emscripten.
set_source_files_properties(src/boundarypacket.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

# Fill projection and shared-edge subdivision use identical double operations
# in Qt, GCC/Clang and Emscripten, including projected-area validation.
set_source_files_properties(src/polygonmesh.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")
