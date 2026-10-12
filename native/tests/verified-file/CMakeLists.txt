cmake_minimum_required(VERSION 3.24)
project(PandoVerifiedFileTests LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 REQUIRED COMPONENTS Core Network Concurrent)
add_executable(verified_file_tests
    ../verified_file_tests.cpp
    ../../app/physicaldatastore.cpp
    ../../app/physicaldatastore.h)
target_include_directories(verified_file_tests PRIVATE ../../app)
target_link_libraries(verified_file_tests PRIVATE Qt6::Core Qt6::Network Qt6::Concurrent)
if(MSVC)
    target_compile_options(verified_file_tests PRIVATE /utf-8)
endif()
enable_testing()
add_test(NAME verified_file_tests COMMAND verified_file_tests)
set_tests_properties(verified_file_tests PROPERTIES TIMEOUT 10)
