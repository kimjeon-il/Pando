cmake_minimum_required(VERSION 3.20)
project(pando_map_evaluation LANGUAGES CXX)
add_executable(pando-map-evaluation evaluation.cpp)
target_compile_features(pando-map-evaluation PRIVATE cxx_std_17)
