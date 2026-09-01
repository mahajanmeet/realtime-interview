cmake_minimum_required(VERSION 3.21)

project(realtime_interview_asr_worker LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(asr-worker src/main.cpp)

set(SHERPA_ONNX_ROOT "" CACHE PATH "Path to an installed sherpa-onnx C API distribution")

find_path(
  SHERPA_ONNX_INCLUDE_DIR
  NAMES sherpa-onnx/c-api/c-api.h
  HINTS "${SHERPA_ONNX_ROOT}/include"
)

find_library(
  SHERPA_ONNX_C_API_LIBRARY
  NAMES sherpa-onnx-c-api libsherpa-onnx-c-api
  HINTS "${SHERPA_ONNX_ROOT}/lib"
)

if(NOT SHERPA_ONNX_INCLUDE_DIR OR NOT SHERPA_ONNX_C_API_LIBRARY)
  message(FATAL_ERROR "Install sherpa-onnx with its C API and set SHERPA_ONNX_ROOT.")
endif()

target_include_directories(asr-worker PRIVATE "${SHERPA_ONNX_INCLUDE_DIR}")
target_link_libraries(asr-worker PRIVATE "${SHERPA_ONNX_C_API_LIBRARY}")

if(WIN32)
  foreach(runtime_dll onnxruntime.dll onnxruntime_providers_shared.dll sherpa-onnx-c-api.dll)
    if(EXISTS "${SHERPA_ONNX_ROOT}/lib/${runtime_dll}")
      add_custom_command(
        TARGET asr-worker
        POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                "${SHERPA_ONNX_ROOT}/lib/${runtime_dll}"
                "$<TARGET_FILE_DIR:asr-worker>"
      )
    elseif(EXISTS "${SHERPA_ONNX_ROOT}/bin/${runtime_dll}")
      add_custom_command(
        TARGET asr-worker
        POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                "${SHERPA_ONNX_ROOT}/bin/${runtime_dll}"
                "$<TARGET_FILE_DIR:asr-worker>"
      )
    endif()
  endforeach()
endif()

if(MSVC)
  target_compile_options(asr-worker PRIVATE /W4 /permissive-)
else()
  target_compile_options(asr-worker PRIVATE -Wall -Wextra -Wpedantic)
endif()
