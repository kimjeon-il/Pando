cmake_minimum_required(VERSION 3.20)
project(pando_terrain_dem_gutters LANGUAGES CXX)
add_executable(pando-terrain-dem-gutters gutters.cpp)
target_compile_features(pando-terrain-dem-gutters PRIVATE cxx_std_17)
