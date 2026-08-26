cmake_minimum_required(VERSION 3.10)
project(soundtouch_jni)

set(CMAKE_CXX_STANDARD 14)

# SoundTouch (LGPL 2.1) - amostras em float (padrao da biblioteca)
add_definitions(-DSOUNDTOUCH_FLOAT_SAMPLES=1)

file(GLOB SOUNDTOUCH_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/soundtouch/*.cpp
)

add_library(
    soundtouch-jni
    SHARED
    soundtouch-jni.cpp
    ${SOUNDTOUCH_SOURCES}
)

target_include_directories(
    soundtouch-jni
    PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/soundtouch
)

target_compile_options(
    soundtouch-jni
    PRIVATE
    -fvisibility=hidden
    -ffast-math
    -O3
)

find_library(log-lib log)

target_link_libraries(
    soundtouch-jni
    ${log-lib}
)
