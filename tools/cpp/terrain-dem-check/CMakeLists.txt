cmake_minimum_required(VERSION 3.20)
project(pando_terrain_dem_check LANGUAGES CXX)
add_executable(pando-terrain-dem-check check.cpp)
target_compile_features(pando-terrain-dem-check PRIVATE cxx_std_17)
