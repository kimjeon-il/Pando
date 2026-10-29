cmake_minimum_required(VERSION 3.21)
project(pando_territorial_tools VERSION 1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
option(PANDO_BUILD_REFERENCE_MODEL "Build the optional native reference-map model" OFF)
if(PANDO_BUILD_REFERENCE_MODEL)
    find_package(Torch REQUIRED)
    separate_arguments(PANDO_TORCH_FLAGS NATIVE_COMMAND "${TORCH_CXX_FLAGS}")
    add_library(pando-reference-core STATIC reference-analysis/boundary-loss.cpp reference-analysis/reference-model.cpp
        reference-analysis/reference-io.cpp reference-analysis/safetensors.cpp reference-analysis/training-checkpoint.cpp reference-analysis/reference-onnx.cpp ../../shared/core/src/losslessjson.cpp)
    target_include_directories(pando-reference-core PRIVATE ../../shared/core/include)
    target_link_libraries(pando-reference-core PUBLIC ${TORCH_LIBRARIES})
    # The installed PyTorch 2.14 headers require C++20; keep other tools on C++17.
    target_compile_features(pando-reference-core PUBLIC cxx_std_20)
    target_compile_options(pando-reference-core PUBLIC ${PANDO_TORCH_FLAGS})
    add_executable(pando-reference-loss-tests reference-analysis/boundary-loss-tests.cpp)
    add_executable(pando-reference-model-tests reference-analysis/reference-model-tests.cpp)
    add_executable(pando-safetensors-tests reference-analysis/safetensors-tests.cpp)
    add_executable(pando-training-checkpoint-tests reference-analysis/training-checkpoint-tests.cpp)
    add_executable(pando-reference-infer reference-analysis/reference-infer.cpp)
    add_executable(pando-reference-training-proof reference-analysis/reference-training-proof.cpp)
    add_executable(pando-reference-onnx-tests reference-analysis/reference-onnx-tests.cpp)
    foreach(target IN ITEMS pando-reference-loss-tests pando-reference-model-tests pando-safetensors-tests pando-training-checkpoint-tests pando-reference-infer pando-reference-training-proof pando-reference-onnx-tests)
        target_link_libraries(${target} PRIVATE pando-reference-core)
    endforeach()
endif()
option(PANDO_BUILD_PC_ALLOCATION "Build the read-only Windows allocation auditor" OFF)
if(PANDO_BUILD_PC_ALLOCATION)
    if(NOT WIN32)
        message(FATAL_ERROR "PC allocation audit requires Windows")
    endif()
    add_executable(pando-pc-file-allocation pc-file-allocation.cpp ../../shared/core/src/losslessjson.cpp)
    target_include_directories(pando-pc-file-allocation PRIVATE ../../shared/core/include)
    target_compile_definitions(pando-pc-file-allocation PRIVATE _WIN32_WINNT=0x0602)
    if(MSVC)
        target_compile_options(pando-pc-file-allocation PRIVATE /utf-8 /W4)
        set_property(TARGET pando-pc-file-allocation PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    endif()
endif()
option(PANDO_BUILD_COUNTRY_VALIDATOR "Build GEOS country validator" ON)
if(PANDO_BUILD_COUNTRY_VALIDATOR)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(GEOS REQUIRED IMPORTED_TARGET geos)
    find_package(ZLIB REQUIRED)
    add_executable(pando-country-geometry-check
        validate-country-geometry.cpp
        ../../shared/core/src/losslessjson.cpp
        ../../shared/core/src/sphericalpolygon.cpp)
    target_include_directories(pando-country-geometry-check PRIVATE ../../shared/core/include)
    target_link_libraries(pando-country-geometry-check PRIVATE PkgConfig::GEOS ZLIB::ZLIB)
    if(MSVC)
        target_compile_options(pando-country-geometry-check PRIVATE /utf-8)
    endif()
endif()

option(PANDO_BUILD_HYDRO_CONNECTIVITY "Build the standalone native HydroRIVERS junction repair engine" OFF)
if(PANDO_BUILD_HYDRO_CONNECTIVITY)
    add_executable(pando-hydro-connectivity
        hydro/connectivity-junctions.cpp
        ../../shared/core/src/losslessjson.cpp)
    target_include_directories(pando-hydro-connectivity PRIVATE ../../shared/core/include)
    if(MSVC)
        target_compile_options(pando-hydro-connectivity PRIVATE /utf-8)
    else()
        # The existing shared losslessjson.cpp triggers GCC's indentation warning;
        # keep all other warnings fatal without editing the shared Web/WASM codec.
        target_compile_options(pando-hydro-connectivity PRIVATE -Wall -Wextra -Werror -Wno-error=misleading-indentation -pedantic)
    endif()
endif()

option(PANDO_BUILD_TERRITORIAL_RECIPE "Build the GEOS/PROJ historical recipe engine" OFF)
if(PANDO_BUILD_TERRITORIAL_RECIPE)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(GEOS REQUIRED IMPORTED_TARGET geos)
    pkg_check_modules(PROJ REQUIRED IMPORTED_TARGET proj)
    add_executable(pando-territorial-recipe
        build-territorial-recipe.cpp
        ../../shared/core/src/losslessjson.cpp
        ../../shared/core/src/sphericalpolygon.cpp)
    target_include_directories(pando-territorial-recipe PRIVATE ../../shared/core/include)
    target_link_libraries(pando-territorial-recipe PRIVATE PkgConfig::GEOS PkgConfig::PROJ)
    if(MSVC)
        target_compile_options(pando-territorial-recipe PRIVATE /utf-8)
    endif()
endif()

# Historical Python recipes use the same pure C++ normalizer as Web and App.
# This target needs neither GEOS nor Zlib on the Windows generation runner.
add_executable(pando-spherical-polygon-normalize
    normalize-polygon-geometry.cpp
    ../../shared/core/src/losslessjson.cpp
    ../../shared/core/src/sphericalpolygon.cpp)
target_include_directories(pando-spherical-polygon-normalize PRIVATE ../../shared/core/include)
if(MSVC)
    target_compile_options(pando-spherical-polygon-normalize PRIVATE /utf-8)
endif()

# Pure core winding normalization remains usable by native and Emscripten;
# it must not depend on the GEOS/PROJ CLI dependencies.
add_executable(pando-spherical-polygon-tests
    spherical-polygon-tests.cpp
    ../../shared/core/src/sphericalpolygon.cpp)
target_include_directories(pando-spherical-polygon-tests PRIVATE ../../shared/core/include)
if(MSVC)
    target_compile_options(pando-spherical-polygon-tests PRIVATE /utf-8)
    target_compile_options(pando-spherical-polygon-tests PRIVATE /UNDEBUG)
else()
    target_compile_options(pando-spherical-polygon-tests PRIVATE -UNDEBUG)
endif()
enable_testing()
add_test(NAME spherical-polygon-normalization COMMAND pando-spherical-polygon-tests)
if(PANDO_BUILD_REFERENCE_MODEL)
    add_test(NAME reference-boundary-loss COMMAND pando-reference-loss-tests)
    add_test(NAME reference-model COMMAND pando-reference-model-tests ${CMAKE_SOURCE_DIR}/../../tests/fixtures/reference-model-synthetic-logits.f32)
    add_test(NAME reference-safetensors COMMAND pando-safetensors-tests)
    add_test(NAME reference-training-checkpoint COMMAND pando-training-checkpoint-tests)
endif()
