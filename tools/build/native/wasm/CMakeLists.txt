add_executable(pandoeditor_wasm "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/bindings/session-bindings.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/bindings/timeline-bindings.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/bindings/boundary-bindings.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/bindings/polygon-bindings.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/rendering/native/bindings/mesh-bindings.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/bindings/cut-bindings.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/bindings/river-bindings.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/geometry/native/bindings/reference-bindings.cpp" "${PANDOEDITOR_REPOSITORY_ROOT}/src/document/native/bindings/place-bindings.cpp")
target_link_libraries(pandoeditor_wasm PRIVATE Pandoeditor::Core)
target_compile_options(pandoeditor_wasm PRIVATE -fwasm-exceptions)
target_compile_definitions(pandoeditor_wasm PRIVATE
    PANDOEDITOR_CORE_SOURCE_SHA256="${PANDOEDITOR_CORE_SOURCE_SHA256}")
# Preserve the existing factory inputs, including the integrity-verified wasmBinary.
# Emscripten 6 removes wasmBinary from its default incoming API list.
set(PANDOEDITOR_WASM_INCOMING_MODULE_JS_API
    ENVIRONMENT GL_MAX_TEXTURE_IMAGE_UNITS SDL_canPlayWithWebAudio SDL_numSimultaneouslyQueuedBuffers INITIAL_MEMORY
    wasmMemory arguments buffer canvas doNotCaptureKeyboard
    dynamicLibraries elementPointerLock extraStackTrace forcedAspectRatio instantiateWasm
    keyboardListeningElement freePreloadedMediaOnUse loadSplitModule locateFile logReadFiles
    mainScriptUrlOrBlob mem monitorRunDependencies noExitRuntime noInitialRun
    onAbort onCustomMessage onExit onFree onFullScreen
    onMalloc onRealloc onRuntimeInitialized postMainLoop postRun
    preInit preMainLoop preRun preinitializedWebGLContext preloadPlugins
    print printErr setStatus statusMessage stderr
    stdin stdout thisProgram wasm wasmBinary
    websocket
)
list(JOIN PANDOEDITOR_WASM_INCOMING_MODULE_JS_API "," PANDOEDITOR_WASM_INCOMING_MODULE_JS_API)
target_link_options(pandoeditor_wasm PRIVATE
    --bind --no-entry -fwasm-exceptions
    "-sMODULARIZE=1" "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createPandoeditorCore"
    "-sENVIRONMENT=web,worker,node"
    "-sINCOMING_MODULE_JS_API=${PANDOEDITOR_WASM_INCOMING_MODULE_JS_API}"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sINITIAL_MEMORY=16777216" "-sMAXIMUM_MEMORY=536870912"
    "-sFILESYSTEM=0")
set_target_properties(pandoeditor_wasm PROPERTIES OUTPUT_NAME pandoeditor-core SUFFIX .js)
# Packaging copies this exact .js/.wasm pair into assets/wasm. Never put compiler
# build output directly in source; Pages must stage only the paired runtime.
