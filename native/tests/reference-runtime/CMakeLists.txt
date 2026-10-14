cmake_minimum_required(VERSION 3.21)
project(PandoeditorReferenceRuntimeCheck LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Qt6 6.5 REQUIRED COMPONENTS Core Qml)
include(CTest)

# This target deliberately cannot link the application, renderer or Qt Quick.
add_executable(reference_runtime_headless ../reference_runtime_headless.cpp)
target_link_libraries(reference_runtime_headless PRIVATE Qt6::Core Qt6::Qml)
if(MSVC)
    target_compile_options(reference_runtime_headless PRIVATE /utf-8)
endif()
get_filename_component(REPOSITORY_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)
set(PANDO_REFERENCE_BASELINE_RUNTIME "" CACHE FILEPATH "Optional exact pre-change runtime for a regression comparison")
if(BUILD_TESTING)
    if(PANDO_REFERENCE_BASELINE_RUNTIME)
        add_test(NAME reference_runtime_regression COMMAND reference_runtime_headless
            "${REPOSITORY_ROOT}/native/app/reference-web/runtime.js"
            "${REPOSITORY_ROOT}/native/tests/fixtures/reference-calibration.json"
            "${PANDO_REFERENCE_BASELINE_RUNTIME}")
        set_tests_properties(reference_runtime_regression PROPERTIES TIMEOUT 15)
    else()
        add_test(NAME reference_runtime_web_contract COMMAND reference_runtime_headless
            "${REPOSITORY_ROOT}/native/app/reference-web/runtime.js"
            "${REPOSITORY_ROOT}/native/tests/fixtures/reference-calibration.json")
        set_tests_properties(reference_runtime_web_contract PROPERTIES TIMEOUT 15)
    endif()
endif()
