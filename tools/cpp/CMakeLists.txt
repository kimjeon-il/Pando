cmake_minimum_required(VERSION 3.21)
project(pando_territorial_tools VERSION 1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
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
