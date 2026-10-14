if(NOT DEFINED PANDO_REFERENCE_SOURCE_ROOT)
    message(FATAL_ERROR "Reference calculation admission requires the unified source root")
endif()
find_program(PANDOEDITOR_NODE_EXECUTABLE NAMES node REQUIRED)
set(PANDO_REFERENCE_VERIFIER "${PANDO_REFERENCE_SOURCE_ROOT}/native/tools/reference-parity/verify-source.mjs")
if(NOT EXISTS "${PANDO_REFERENCE_VERIFIER}")
    message(FATAL_ERROR "Required reference calculation verifier is missing")
endif()
# Source hashes and runtime bytes must agree before native resources are built.
# This does not alter golden fixtures or regenerate a stale artifact implicitly.
add_custom_target(pandoeditor_reference_runtime_check
    COMMAND "${PANDOEDITOR_NODE_EXECUTABLE}" "${PANDO_REFERENCE_VERIFIER}"
    DEPENDS "${PANDO_REFERENCE_VERIFIER}"
        "${PANDO_REFERENCE_SOURCE_ROOT}/native/tools/reference-parity/source-manifest.mjs"
        "${PANDO_REFERENCE_SOURCE_ROOT}/native/app/reference-web/manifest.json"
        "${PANDO_REFERENCE_SOURCE_ROOT}/native/app/reference-web/runtime.js"
    VERBATIM)
