cmake_minimum_required(VERSION 3.20)
project(pando_reference_conditions LANGUAGES CXX)
add_executable(reference-conditions-test ../condition-sampling-tests.cpp)
target_compile_features(reference-conditions-test PRIVATE cxx_std_17)
