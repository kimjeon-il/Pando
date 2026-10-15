# Explicit remote Web/native differential checks. Never part of the default native test set.
find_program(PANDO_REMOTE_PARITY_NODE NAMES node REQUIRED)
add_test(NAME m971_editing_oracle_contract
    COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test
        "${PROJECT_SOURCE_DIR}/tools/m97/contract.test.mjs"
        "${PROJECT_SOURCE_DIR}/tools/m97/calculations.test.mjs"
        "${PROJECT_SOURCE_DIR}/tools/m97/corpus.test.mjs"
        "${PROJECT_SOURCE_DIR}/tools/m97/cut-corpus.test.mjs"
        "${PROJECT_SOURCE_DIR}/tools/m97/native-baseline.test.mjs"
        "${PROJECT_SOURCE_DIR}/tools/m97/web-lifecycle.test.mjs"
        "${PROJECT_SOURCE_DIR}/tools/m97/web-selection.test.mjs"
        "${PROJECT_SOURCE_DIR}/tools/m97/registration.test.mjs")
set_tests_properties(m971_editing_oracle_contract PROPERTIES TIMEOUT 60)
add_test(NAME m972_river_oracle_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test
    "${PROJECT_SOURCE_DIR}/tools/m97/river-kernel.test.mjs")
    if(PANDOEDITOR_ENABLE_PYTHON_ORACLES)
set_tests_properties(m972_river_oracle_contract PROPERTIES
        ENVIRONMENT "PANDOEDITOR_ENABLE_PYTHON_ORACLES=1;PANDOEDITOR_PYTHON_EXECUTABLE=${Python3_EXECUTABLE}")
endif()
add_test(NAME m972_river_synthetic_browser_baseline COMMAND "${PANDO_REMOTE_PARITY_NODE}"
    "${PROJECT_SOURCE_DIR}/tools/m97/river/differential.mjs" --native "$<TARGET_FILE:m972_river_probe>" --synthetic)
add_test(NAME m972_river_full_source_browser_baseline COMMAND "${PANDO_REMOTE_PARITY_NODE}" --max-old-space-size=256
    "${PROJECT_SOURCE_DIR}/tools/m97/river/differential.mjs" --native "$<TARGET_FILE:m972_river_probe>" --full)
set_tests_properties(m972_river_full_source_browser_baseline PROPERTIES TIMEOUT 240 LABELS "full-data;river-parity")
add_test(NAME terrain_dem_source_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}"
    --test "${PROJECT_SOURCE_DIR}/tools/terrain-dem-contract.test.mjs")
add_test(NAME m72_packet_corpus
    COMMAND "${CMAKE_COMMAND}" -E env
        "M72_PACKET_PROBE=$<TARGET_FILE:m72_packet_corpus_probe>"
        "${PANDO_REMOTE_PARITY_NODE}" --test
        "${PROJECT_SOURCE_DIR}/tools/m72-packet-corpus.test.mjs")
add_test(NAME m72_projection_web_oracle
    COMMAND "${CMAKE_COMMAND}" -E env
        "M72_PROJECTION_PROBE=$<TARGET_FILE:m72_projection_tests>"
        "${PANDO_REMOTE_PARITY_NODE}" --test
        "${PROJECT_SOURCE_DIR}/tools/m72-projection-oracle.test.mjs")
add_test(NAME m972_controller_web_differential
    COMMAND "${CMAKE_COMMAND}" -E env
        "PANDO_M972_SELECTION_PROBE=$<TARGET_FILE:m972_selection_probe>"
        "${PANDO_REMOTE_PARITY_NODE}" --test
        "${PROJECT_SOURCE_DIR}/tools/m97/native-selection.test.mjs")
set_tests_properties(m972_controller_web_differential PROPERTIES
    TIMEOUT 180 ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software")
add_test(NAME web_v10_exchange_source_contract
    COMMAND "${PANDO_REMOTE_PARITY_NODE}" "${PROJECT_SOURCE_DIR}/tools/web-v10-exchange-oracle.mjs" --verify-only)
add_test(NAME web_v10_exchange_oracle_unit
    COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test "${PROJECT_SOURCE_DIR}/tests/fixtures/web-v10-exchange/oracle.test.mjs")
add_test(NAME web_v10_production_codec_cross_exchange
    COMMAND "${PANDO_REMOTE_PARITY_NODE}" "${PROJECT_SOURCE_DIR}/tools/web-v10-exchange-oracle.mjs"
        --native "$<TARGET_FILE:timeline_project_tests>" "${PROJECT_BINARY_DIR}/test-results/web-v10-exchange")
set_tests_properties(web_v10_production_codec_cross_exchange PROPERTIES TIMEOUT 180)
add_test(NAME m973_split_controller_contract
    COMMAND "${CMAKE_COMMAND}" -E env "PANDO_M973_SPLIT_PROBE=$<TARGET_FILE:m973_split_controller_probe>"
        "${PANDO_REMOTE_PARITY_NODE}" --test "${PROJECT_SOURCE_DIR}/tools/m97/split-differential-native.test.mjs")
set_tests_properties(m973_split_controller_contract PROPERTIES TIMEOUT 180
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software")
add_test(NAME m974_native_boundary_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test "${PROJECT_SOURCE_DIR}/tools/m974-native-boundary.test.mjs")
set_tests_properties(m974_native_boundary_contract PROPERTIES TIMEOUT 120)
add_test(NAME m974_native_snap_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test "${PROJECT_SOURCE_DIR}/tools/m974-native-snap.test.mjs")
set_tests_properties(m974_native_snap_contract PROPERTIES TIMEOUT 120)
add_test(NAME m974_native_supplemental_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test "${PROJECT_SOURCE_DIR}/tools/m974-native-supplemental.test.mjs")
set_tests_properties(m974_native_supplemental_contract PROPERTIES TIMEOUT 120)
add_test(NAME m974_source_order_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test
"${PROJECT_SOURCE_DIR}/tools/m974-native-source-order.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m974-snap-boundary/source-order-v2.test.mjs")
set_tests_properties(m974_source_order_contract PROPERTIES TIMEOUT 120)
add_test(NAME m974_source_history_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test
"${PROJECT_SOURCE_DIR}/tools/m974-native-source-history.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m974-snap-boundary/source-history-runtime.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m974-snap-boundary/source-history-selection.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m974-snap-boundary/source-history-sources.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m974-snap-boundary/source-history-suite.test.mjs")
set_tests_properties(m974_source_history_contract PROPERTIES TIMEOUT 120)
add_test(NAME m977_pending_lifecycle_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test
"${PROJECT_SOURCE_DIR}/tools/m977-pending-lifecycle/runtime.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-pending-lifecycle/contract.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-pending-lifecycle/native.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-pending-lifecycle/suite.test.mjs"
"${PROJECT_SOURCE_DIR}/tests/m977-pending-lifecycle-integration.test.mjs")
set_tests_properties(m977_pending_lifecycle_contract PROPERTIES TIMEOUT 180
ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;M977_PENDING_LIFECYCLE_PROBE=$<TARGET_FILE:m977_pending_lifecycle_probe>")
add_test(NAME m977_pending_input_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test
"${PROJECT_SOURCE_DIR}/tools/m977-pending-input/sources.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-pending-input/runtime.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-pending-input/suite.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-pending-input/browser-runner.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-pending-input/native.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-pending-input/compare.test.mjs")
set_tests_properties(m977_pending_input_contract PROPERTIES TIMEOUT 180
ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;PANDO_M977_NATIVE_PROBE=$<TARGET_FILE:m977_pending_input_probe>")
add_test(NAME m977_boundary_timing_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-adoption/runtime.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-adoption/suite.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-adoption/browser-runner.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-adoption/native.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-integration.test.mjs")
set_tests_properties(m977_boundary_timing_contract PROPERTIES TIMEOUT 180
WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}"
ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;M977_BOUNDARY_PROBE=$<TARGET_FILE:m977_boundary_timing_probe>")
add_test(NAME m977_boundary_session_replacement_contract COMMAND "${PANDO_REMOTE_PARITY_NODE}" --test
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-session-replacement/runtime.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-session-replacement/suite.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-session-replacement/browser-runner.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-session-replacement/native.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-session-replacement/gate.test.mjs"
"${PROJECT_SOURCE_DIR}/tools/m977-boundary-session-integration.test.mjs")
set_tests_properties(m977_boundary_session_replacement_contract PROPERTIES TIMEOUT 180
WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}"
ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;M977_SESSION_REPLACEMENT_PROBE=$<TARGET_FILE:m977_boundary_session_replacement_probe>")
