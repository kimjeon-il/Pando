cmake_minimum_required(VERSION 3.21)
project(CurrentGeometryCheck LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
find_package(Qt6 6.5 REQUIRED COMPONENTS Core Qml)
get_filename_component(PANDO_GEOMETRY_REPO "${CMAKE_CURRENT_LIST_DIR}/../../.." ABSOLUTE)
if(TARGET Pandoeditor::Core)
    set(PANDO_GEOMETRY_CORE Pandoeditor::Core)
else()
    if(NOT DEFINED PANDO_CORE_LIBRARY OR NOT EXISTS "${PANDO_CORE_LIBRARY}")
        message(FATAL_ERROR "Current geometry check requires a separately built native PANDO_CORE_LIBRARY")
    endif()
    add_library(current_geometry_core STATIC IMPORTED)
    set_target_properties(current_geometry_core PROPERTIES
        IMPORTED_LOCATION "${PANDO_CORE_LIBRARY}"
        INTERFACE_INCLUDE_DIRECTORIES "${PANDO_GEOMETRY_REPO}/shared/core/include")
    set(PANDO_GEOMETRY_CORE current_geometry_core)
endif()
qt_add_resources(PANDO_GEOMETRY_CURRENT_RESOURCES "${PANDO_GEOMETRY_REPO}/native/resources/current_geometry.qrc")
add_executable(current_geometry_tests "${PANDO_GEOMETRY_REPO}/native/tests/current_geometry_tests.cpp"
    "${PANDO_GEOMETRY_REPO}/native/app/geometrycalculator.cpp"
    "${PANDO_GEOMETRY_REPO}/native/app/cutgeometrycalculator.cpp"
    "${PANDO_GEOMETRY_REPO}/native/app/splitgeometrynormalizer.cpp"
    "${PANDO_GEOMETRY_REPO}/native/app/riverpartitioncalculator.cpp"
    "${PANDO_GEOMETRY_REPO}/native/app/riverareacalculator.cpp" ${PANDO_GEOMETRY_CURRENT_RESOURCES})
target_include_directories(current_geometry_tests PRIVATE "${PANDO_GEOMETRY_REPO}/native/app"
    "${PANDO_GEOMETRY_REPO}/native/engine/include" "${PANDO_GEOMETRY_REPO}/native/assets/geometry/current")
target_compile_definitions(current_geometry_tests PRIVATE
    PANDO_GEOMETRY_CUT_FIXTURE="${PANDO_GEOMETRY_REPO}/native/tests/fixtures/web-m97/cut-corpus.json")
target_link_libraries(current_geometry_tests PRIVATE ${PANDO_GEOMETRY_CORE} Qt6::Core Qt6::Qml)
if(MSVC)
    target_compile_options(current_geometry_tests PRIVATE /utf-8)
endif()
enable_testing()
add_test(NAME current_geometry_tests COMMAND current_geometry_tests)
set_tests_properties(current_geometry_tests PROPERTIES TIMEOUT 15)
