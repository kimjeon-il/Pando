cmake_minimum_required(VERSION 3.21)
project(pando_territorial_tools VERSION 1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
option(PANDO_BUILD_MAP_IMAGE "Build the optional native map image primitives" OFF)
if(PANDO_BUILD_MAP_IMAGE)
    enable_language(C)
    include(FetchContent)
    set(ZLIB_BUILD_SHARED OFF)
    set(ZLIB_BUILD_STATIC ON)
    set(ZLIB_BUILD_TESTING OFF)
    set(ZLIB_INSTALL OFF)
    FetchContent_Declare(pando_zlib
        URL https://github.com/madler/zlib/releases/download/v1.3.2/zlib-1.3.2.tar.gz
        URL_HASH SHA256=bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16)
    FetchContent_MakeAvailable(pando_zlib)
    FetchContent_Declare(pando_libpng
        URL https://codeload.github.com/pnggroup/libpng/tar.gz/95ab3fdca83ea294efd3b092e9a53c5a39886444
        URL_HASH SHA256=94545cd40229f31bb2edc48843a2697adf27bc8c8e979ae3d22f83f39915ad96)
    FetchContent_GetProperties(pando_libpng)
    if(NOT pando_libpng_POPULATED)
        FetchContent_Populate(pando_libpng)
    endif()
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/map-image-include")
    configure_file("${pando_libpng_SOURCE_DIR}/scripts/pnglibconf.h.prebuilt" "${CMAKE_CURRENT_BINARY_DIR}/map-image-include/pnglibconf.h" COPYONLY)
    add_library(pando-map-png STATIC)
    foreach(file IN ITEMS png pngerror pngget pngmem pngpread pngread pngrio pngrtran pngrutil pngset pngtrans pngwio pngwrite pngwtran pngwutil)
        target_sources(pando-map-png PRIVATE "${pando_libpng_SOURCE_DIR}/${file}.c")
    endforeach()
    target_include_directories(pando-map-png PUBLIC "${pando_libpng_SOURCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/map-image-include")
    target_link_libraries(pando-map-png PUBLIC zlibstatic)
    # libjpeg-turbo requires its own top-level CMake project.
    include(ExternalProject)
    set(PANDO_JPEG_INSTALL "${CMAKE_CURRENT_BINARY_DIR}/jpeg-sdk/install")
    if(MSVC)
        set(PANDO_JPEG_LIBRARY "${PANDO_JPEG_INSTALL}/lib/jpeg-static.lib")
    else()
        set(PANDO_JPEG_LIBRARY "${PANDO_JPEG_INSTALL}/lib/${CMAKE_STATIC_LIBRARY_PREFIX}jpeg${CMAKE_STATIC_LIBRARY_SUFFIX}")
    endif()
    ExternalProject_Add(pando_jpeg_external
        URL https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.1.4.1/libjpeg-turbo-3.1.4.1.tar.gz
        URL_HASH SHA256=ecae8008e2cc9ade2f2c1bb9d5e6d4fb73e7c433866a056bd82980741571a022
        INSTALL_DIR "${PANDO_JPEG_INSTALL}"
        CMAKE_ARGS -DCMAKE_INSTALL_PREFIX=<INSTALL_DIR> -DCMAKE_INSTALL_LIBDIR=lib
            -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE} -DENABLE_SHARED=OFF -DENABLE_STATIC=ON
            -DWITH_SIMD=OFF -DWITH_TURBOJPEG=OFF -DWITH_TOOLS=OFF -DWITH_TESTS=OFF
        BUILD_BYPRODUCTS "${PANDO_JPEG_LIBRARY}")
    add_library(pando-jpeg STATIC IMPORTED)
    set_target_properties(pando-jpeg PROPERTIES IMPORTED_LOCATION "${PANDO_JPEG_LIBRARY}")
    add_dependencies(pando-jpeg pando_jpeg_external)
    set(BUILD_SHARED_LIBS OFF)
    set(WEBP_LINK_STATIC ON)
    set(WEBP_USE_THREAD OFF)
    foreach(feature ANIM_UTILS CWEBP DWEBP GIF2WEBP IMG2WEBP VWEBP WEBPINFO LIBWEBPMUX WEBPMUX EXTRAS)
        set(WEBP_BUILD_${feature} OFF)
    endforeach()
    FetchContent_Declare(pando_webp
        URL https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz
        URL_HASH SHA256=e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564)
    FetchContent_MakeAvailable(pando_webp)
    add_executable(pando-map-image map-image/resample.cpp map-image/png.cpp map-image/png-read.c map-image/jpeg-read.c map-image/webp-read.c map-image/image-input.cpp map-image/main.cpp)
    target_include_directories(pando-map-image PRIVATE "${PANDO_JPEG_INSTALL}/include")
    target_link_libraries(pando-map-image PRIVATE pando-map-png pando-jpeg webpdemux)
endif()
option(PANDO_BUILD_PC_ALLOCATION "Build the read-only Windows allocation auditor" OFF)
if(PANDO_BUILD_PC_ALLOCATION)
    if(NOT WIN32)
        message(FATAL_ERROR "PC allocation audit requires Windows")
    endif()
    add_executable(pando-pc-file-allocation pc-file-allocation.cpp ../../src/data/native/src/losslessjson.cpp)
    target_include_directories(pando-pc-file-allocation PRIVATE ../../src/document/native/include ../../src/geometry/native/include ../../src/map/native/include ../../src/rendering/native/include ../../src/data/native/include ../../src/runtime/native/include)
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
        ../../src/data/native/src/losslessjson.cpp
        ../../src/geometry/native/src/sphericalpolygon.cpp)
    target_include_directories(pando-country-geometry-check PRIVATE ../../src/document/native/include ../../src/geometry/native/include ../../src/map/native/include ../../src/rendering/native/include ../../src/data/native/include ../../src/runtime/native/include)
    target_link_libraries(pando-country-geometry-check PRIVATE PkgConfig::GEOS ZLIB::ZLIB)
    if(MSVC)
        target_compile_options(pando-country-geometry-check PRIVATE /utf-8)
    endif()
endif()

option(PANDO_BUILD_HYDRO_CONNECTIVITY "Build the standalone native HydroRIVERS junction repair engine" OFF)
if(PANDO_BUILD_HYDRO_CONNECTIVITY)
    add_executable(pando-hydro-connectivity
        hydro/connectivity-junctions.cpp
        ../../src/data/native/src/losslessjson.cpp)
    target_include_directories(pando-hydro-connectivity PRIVATE ../../src/document/native/include ../../src/geometry/native/include ../../src/map/native/include ../../src/rendering/native/include ../../src/data/native/include ../../src/runtime/native/include)
    if(MSVC)
        target_compile_options(pando-hydro-connectivity PRIVATE /utf-8)
    else()
        # The existing shared losslessjson.cpp triggers GCC's indentation warning;
        # keep all other warnings fatal without editing the shared Web/WASM codec.
        target_compile_options(pando-hydro-connectivity PRIVATE -Wall -Wextra -Werror -Wno-error=misleading-indentation -pedantic)
    endif()
endif()

option(PANDO_BUILD_HYDRO_POINT_SCREEN "Build the optional independent Hydro point screening tool" OFF)
if(PANDO_BUILD_HYDRO_POINT_SCREEN)
    add_executable(pando-hydro-point-screen hydro/point-screen.cpp ../../src/data/native/src/losslessjson.cpp)
    target_include_directories(pando-hydro-point-screen PRIVATE ../../src/document/native/include ../../src/geometry/native/include ../../src/map/native/include ../../src/rendering/native/include ../../src/data/native/include ../../src/runtime/native/include)
    if(WIN32)
        if(NOT PANDO_QGIS_SDK_ROOT)
            message(FATAL_ERROR "The Windows Hydro point screen needs the matching OSGeo4W SDK root")
        endif()
        target_include_directories(pando-hydro-point-screen PRIVATE "${PANDO_QGIS_SDK_ROOT}/include")
        target_link_libraries(pando-hydro-point-screen PRIVATE "${PANDO_QGIS_SDK_ROOT}/lib/geos_c.lib" "${PANDO_QGIS_SDK_ROOT}/lib/proj.lib")
        if(MSVC)
            target_compile_options(pando-hydro-point-screen PRIVATE /utf-8)
        endif()
    else()
        find_package(PkgConfig REQUIRED)
        pkg_check_modules(GEOS REQUIRED IMPORTED_TARGET geos)
        pkg_check_modules(PROJ REQUIRED IMPORTED_TARGET proj)
        target_link_libraries(pando-hydro-point-screen PRIVATE PkgConfig::GEOS PkgConfig::PROJ)
    endif()
endif()

# Historical Python recipes use the same pure C++ normalizer as Web and App.
# This target needs neither GEOS nor Zlib on the Windows generation runner.
add_executable(pando-spherical-polygon-normalize
    normalize-polygon-geometry.cpp
    ../../src/data/native/src/losslessjson.cpp
    ../../src/geometry/native/src/sphericalpolygon.cpp)
target_include_directories(pando-spherical-polygon-normalize PRIVATE ../../src/document/native/include ../../src/geometry/native/include ../../src/map/native/include ../../src/rendering/native/include ../../src/data/native/include ../../src/runtime/native/include)
if(MSVC)
    target_compile_options(pando-spherical-polygon-normalize PRIVATE /utf-8)
endif()
