cmake_minimum_required(VERSION 3.21)

# A single *entry point*, not a second copy of the shared C++ targets.
# Exactly one component is configured per build tree: native already includes
# shared/core, while shared includes the same core for standalone and WASM.
project(PandoLab LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(PANDO_BUILD_VARIANT "core" CACHE STRING "One of: core, native, wasm, gis-tools")
set_property(CACHE PANDO_BUILD_VARIANT PROPERTY STRINGS core native wasm gis-tools)
set(_variants core native wasm gis-tools)
if(NOT PANDO_BUILD_VARIANT IN_LIST _variants)
    message(FATAL_ERROR "Unknown PANDO_BUILD_VARIANT=${PANDO_BUILD_VARIANT}")
endif()
if(EMSCRIPTEN AND NOT PANDO_BUILD_VARIANT STREQUAL "wasm")
    message(FATAL_ERROR "Emscripten builds must select PANDO_BUILD_VARIANT=wasm")
endif()
if(PANDO_BUILD_VARIANT STREQUAL "wasm" AND NOT EMSCRIPTEN)
    message(FATAL_ERROR "PANDO_BUILD_VARIANT=wasm requires emcmake/Emscripten")
endif()

# Register top-level CTest entries; individual sources decide which tests exist.
include(CTest)

if(PANDO_BUILD_VARIANT STREQUAL "core" OR PANDO_BUILD_VARIANT STREQUAL "wasm")
    if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/shared/CMakeLists.txt")
        message(FATAL_ERROR "This branch has no shared/ C++ source. Sync the integrated branch before building core/WASM.")
    endif()
    add_subdirectory(shared)
elseif(PANDO_BUILD_VARIANT STREQUAL "native")
    if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/native/CMakeLists.txt")
        message(FATAL_ERROR "This branch has no native/ Qt source. Sync the integrated branch before building the app.")
    endif()
    add_subdirectory(native)
else()
    if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/tools/cpp/CMakeLists.txt")
        message(FATAL_ERROR "This branch has no tools/cpp/ GIS C++ sources.")
    endif()
    add_subdirectory(tools/cpp)
endif()
