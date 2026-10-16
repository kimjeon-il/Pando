cmake_minimum_required(VERSION 3.21)
project(NativeBuildGuard LANGUAGES CXX)
add_executable(denied_tool denied-tool.cpp)
foreach(tool IN ITEMS node nodejs npm npx pnpm python python3 python3.12 py)
    add_custom_command(TARGET denied_tool POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${CMAKE_BINARY_DIR}/bin"
        COMMAND "${CMAKE_COMMAND}" -E copy "$<TARGET_FILE:denied_tool>"
            "${CMAKE_BINARY_DIR}/bin/${tool}${CMAKE_EXECUTABLE_SUFFIX}")
endforeach()
