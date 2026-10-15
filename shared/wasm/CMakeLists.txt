add_executable(pandoeditor_wasm session-bindings.cpp timeline-bindings.cpp boundary-bindings.cpp polygon-bindings.cpp mesh-bindings.cpp cut-bindings.cpp river-bindings.cpp reference-bindings.cpp)
target_link_libraries(pandoeditor_wasm PRIVATE Pandoeditor::Core)
target_compile_options(pandoeditor_wasm PRIVATE -fwasm-exceptions)
target_compile_definitions(pandoeditor_wasm PRIVATE
    PANDOEDITOR_CORE_SOURCE_SHA256="${PANDOEDITOR_CORE_SOURCE_SHA256}")
target_link_options(pandoeditor_wasm PRIVATE
    --bind --no-entry -fwasm-exceptions
    "-sMODULARIZE=1" "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createPandoeditorCore"
    "-sENVIRONMENT=web,worker,node"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sINITIAL_MEMORY=16777216" "-sMAXIMUM_MEMORY=536870912"
    "-sFILESYSTEM=0")
set_target_properties(pandoeditor_wasm PROPERTIES OUTPUT_NAME pandoeditor-core SUFFIX .js)
# Packaging copies this exact .js/.wasm pair into assets/wasm. Never put compiler
# build output directly in source; Pages must stage only the paired runtime.
