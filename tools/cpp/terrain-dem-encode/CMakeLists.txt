cmake_minimum_required(VERSION 3.20)
project(pando_terrain_dem_encode LANGUAGES CXX)
add_executable(pando-terrain-dem-encode encode.cpp)
target_compile_features(pando-terrain-dem-encode PRIVATE cxx_std_17)
