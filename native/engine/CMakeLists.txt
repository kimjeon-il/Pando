set(THREADS_PREFER_PTHREAD_FLAG ON)
find_package(Threads REQUIRED)

add_library(pandoeditor_map_engine STATIC
    src/resourcecachepolicy.cpp
    src/engine.cpp
    src/mapviewstate.cpp
    src/mapcamera.cpp
    src/editcoordinates.cpp
    src/editgeometry.cpp
    src/mappicker.cpp
    src/viewportresourcescheduler.cpp
    src/builtinhydrochannel.cpp
    src/labelengine.cpp
    src/projectionengine.cpp
    src/renderlod.cpp
    src/renderquality.cpp
    src/countryculling.cpp
    src/renderpacket.cpp
    src/renderscene.cpp
    src/scenepatch.cpp
    src/geometrypacketcache.cpp
    src/mapscenebuilder.cpp
    src/geometrysnap.cpp
    src/sharedboundary.cpp
    src/territorialpreview.cpp
    include/pandoeditor/map/territorialpreview.h
    src/territoryselection.cpp
    include/pandoeditor/map/territoryselection.h
)
add_library(Pandoeditor::MapEngine ALIAS pandoeditor_map_engine)

target_include_directories(pandoeditor_map_engine PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}/include"
)
target_include_directories(pandoeditor_map_engine PRIVATE
    "${PROJECT_SOURCE_DIR}/third_party/earcut"
)
target_compile_features(pandoeditor_map_engine PUBLIC cxx_std_17)
target_link_libraries(pandoeditor_map_engine PUBLIC Pandoeditor::Core Threads::Threads)
set_target_properties(pandoeditor_map_engine PROPERTIES POSITION_INDEPENDENT_CODE ON)

if(BUILD_TESTING)
    add_executable(prepared_scene_tests ../tests/prepared_scene_tests.cpp)
    target_link_libraries(prepared_scene_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME prepared_scene_tests COMMAND prepared_scene_tests)
    set_tests_properties(prepared_scene_tests PROPERTIES TIMEOUT 15)
    find_package(Qt6 REQUIRED COMPONENTS Core)
    add_executable(m72_mapprojection_lifetime_tests
        ../tests/m72_mapprojection_lifetime_tests.cpp ../renderer/mapprojection.cpp)
    target_include_directories(m72_mapprojection_lifetime_tests PRIVATE ../renderer)
    target_link_libraries(m72_mapprojection_lifetime_tests PRIVATE Pandoeditor::MapEngine Qt6::Core)
    add_test(NAME m72_mapprojection_lifetime_tests COMMAND m72_mapprojection_lifetime_tests)
    set_tests_properties(m72_mapprojection_lifetime_tests PROPERTIES TIMEOUT 15)
    find_package(Qt6 REQUIRED COMPONENTS Concurrent Network)
    find_package(ZLIB REQUIRED)
    add_executable(startup_source_tests ../tests/startup_source_tests.cpp
        ../app/hydroruntimeprovider.cpp ../app/hydroruntimeprovider.h
        ../app/hydroloadscheduler.cpp ../app/hydroloadscheduler.h
        ../app/hydroassetreader.cpp ../app/hydromanifest.cpp ../app/hydrometadata.cpp
        ../app/hydroshardreader.cpp ../app/hydroruntimecache.cpp
        ../app/physicaldatastore.cpp ../app/physicaldatastore.h)
    set_target_properties(startup_source_tests PROPERTIES AUTOMOC ON)
    target_include_directories(startup_source_tests PRIVATE ../app)
    target_compile_definitions(startup_source_tests PRIVATE
        WEB_HYDRO_FIXTURE="${PROJECT_SOURCE_DIR}/tests/fixtures/web-hydro")
    target_link_libraries(startup_source_tests PRIVATE Pandoeditor::MapEngine Qt6::Core Qt6::Concurrent Qt6::Network ZLIB::ZLIB)
    add_test(NAME startup_source_tests COMMAND startup_source_tests)
    set_tests_properties(startup_source_tests PROPERTIES TIMEOUT 15)
endif()

# JavaScript's specified intermediate operations must not be fused on native targets.
set_source_files_properties(src/geometrysnap.cpp src/sharedboundary.cpp src/editcoordinates.cpp PROPERTIES COMPILE_OPTIONS
    "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>;$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")

if(BUILD_TESTING)
    add_executable(terrain_land_mask_tests ../tests/terrain_land_mask_tests.cpp)
    target_link_libraries(terrain_land_mask_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME terrain_land_mask_tests COMMAND terrain_land_mask_tests)
    add_executable(edit_coordinate_tests ../tests/edit_coordinate_tests.cpp)
    target_link_libraries(edit_coordinate_tests PRIVATE Pandoeditor::MapEngine)
    target_compile_options(edit_coordinate_tests PRIVATE
        "$<$<CXX_COMPILER_ID:MSVC>:/fp:strict>" "$<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-ffp-contract=off>")
    add_test(NAME edit_coordinate_tests COMMAND edit_coordinate_tests)
    add_executable(edit_geometry_tests ../tests/edit_geometry_tests.cpp)
    target_link_libraries(edit_geometry_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME edit_geometry_tests COMMAND edit_geometry_tests)
    add_executable(territorial_preview_engine_tests ../tests/territorial_preview_engine_tests.cpp)
    target_link_libraries(territorial_preview_engine_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME territorial_preview_engine_tests COMMAND territorial_preview_engine_tests)
    add_executable(territory_selection_engine_tests ../tests/territory_selection_engine_tests.cpp)
    target_link_libraries(territory_selection_engine_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME territory_selection_engine_tests COMMAND territory_selection_engine_tests)
    add_executable(m976_shared_boundary_engine_tests ../tests/m976_shared_boundary_engine_tests.cpp)
    target_link_libraries(m976_shared_boundary_engine_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME m976_shared_boundary_engine_tests COMMAND m976_shared_boundary_engine_tests)
    add_executable(m974_snap_tests ../tests/m974_snap_tests.cpp)
    target_link_libraries(m974_snap_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME m974_snap_tests COMMAND m974_snap_tests)
    add_executable(resource_cache_policy_tests ../tests/resource_cache_policy_tests.cpp)
    target_link_libraries(resource_cache_policy_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME resource_cache_policy_tests COMMAND resource_cache_policy_tests)
    add_executable(map_engine_boundary_tests ../tests/map_engine_boundary_tests.cpp)
    target_link_libraries(map_engine_boundary_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME map_engine_boundary_tests COMMAND map_engine_boundary_tests)
    add_executable(map_camera_tests ../tests/map_camera_tests.cpp)
    target_link_libraries(map_camera_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME map_camera_tests COMMAND map_camera_tests)
    add_executable(map_picker_tests ../tests/map_picker_tests.cpp)
    target_link_libraries(map_picker_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME map_picker_tests COMMAND map_picker_tests)
    add_executable(viewport_resource_scheduler_tests ../tests/viewport_resource_scheduler_tests.cpp)
    target_link_libraries(viewport_resource_scheduler_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME viewport_resource_scheduler_tests COMMAND viewport_resource_scheduler_tests)
    add_executable(builtin_hydro_channel_tests ../tests/builtin_hydro_channel_tests.cpp)
    target_link_libraries(builtin_hydro_channel_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME builtin_hydro_channel_tests COMMAND builtin_hydro_channel_tests)
    add_executable(label_engine_tests ../tests/label_engine_tests.cpp)
    target_link_libraries(label_engine_tests PRIVATE Pandoeditor::MapEngine)
    add_test(NAME label_engine_tests COMMAND label_engine_tests)
    if(PANDOEDITOR_M6_NODE_EXECUTABLE)
        add_executable(flag_layout_probe ../tests/flag_layout_probe.cpp)
        target_link_libraries(flag_layout_probe PRIVATE Pandoeditor::MapEngine)
        add_test(NAME flag_layout_web_parity COMMAND "${PANDOEDITOR_M6_NODE_EXECUTABLE}"
            "${PROJECT_SOURCE_DIR}/tools/flag-layout-web-oracle.mjs" "$<TARGET_FILE:flag_layout_probe>")
    endif()
endif()
