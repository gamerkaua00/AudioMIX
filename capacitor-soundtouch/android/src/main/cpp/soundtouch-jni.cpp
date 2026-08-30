// soundtouch-jni.cpp
// Wrapper JNI enxuto sobre a SoundTouch Library (LGPL 2.1, Olli Parviainen).
// Expoe apenas o necessario para pitch-shift offline com tempo preservado:
// criar instancia, configurar pitch/canais/sampleRate, empurrar amostras,
// receber amostras processadas, flush e destruir.
//
// Ver LICENSE-SOUNDTOUCH-LGPL.txt para os termos da biblioteca SoundTouch.

#include <jni.h>
#include <cstdlib>
#include "soundtouch/SoundTouch.h"

using namespace soundtouch;

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_kmz_soundtouch_SoundTouchNative_nativeCreate(
        JNIEnv *env, jclass clazz, jint channels, jint sampleRate) {
    SoundTouch *st = new SoundTouch();
    st->setChannels((uint) channels);
    st->setSampleRate((uint) sampleRate);
    // Preset de qualidade: bom equilibrio entre qualidade vocal e desempenho mobile.
    st->setSetting(SETTING_USE_QUICKSEEK, 0);
    st->setSetting(SETTING_USE_AA_FILTER, 1);
    return reinterpret_cast<jlong>(st);
}

JNIEXPORT void JNICALL
Java_com_kmz_soundtouch_SoundTouchNative_nativeSetPitchSemiTones(
        JNIEnv *env, jclass clazz, jlong handle, jfloat semitones) {
    if (handle == 0) return;
    reinterpret_cast<SoundTouch *>(handle)->setPitchSemiTones(semitones);
}

JNIEXPORT void JNICALL
Java_com_kmz_soundtouch_SoundTouchNative_nativePutSamples(
        JNIEnv *env, jclass clazz, jlong handle, jfloatArray samples, jint numSamples) {
    if (handle == 0) return;
    SoundTouch *st = reinterpret_cast<SoundTouch *>(handle);
    jfloat *buf = env->GetFloatArrayElements(samples, nullptr);
    st->putSamples(reinterpret_cast<SAMPLETYPE *>(buf), (uint) numSamples);
    env->ReleaseFloatArrayElements(samples, buf, JNI_ABORT);
}

JNIEXPORT jint JNICALL
Java_com_kmz_soundtouch_SoundTouchNative_nativeReceiveSamples(
        JNIEnv *env, jclass clazz, jlong handle, jfloatArray outBuffer, jint maxSamples) {
    if (handle == 0) return 0;
    SoundTouch *st = reinterpret_cast<SoundTouch *>(handle);
    jfloat *buf = env->GetFloatArrayElements(outBuffer, nullptr);
    uint received = st->receiveSamples(reinterpret_cast<SAMPLETYPE *>(buf), (uint) maxSamples);
    env->ReleaseFloatArrayElements(outBuffer, buf, 0);
    return (jint) received;
}

JNIEXPORT jint JNICALL
Java_com_kmz_soundtouch_SoundTouchNative_nativeAvailableSamples(
        JNIEnv *env, jclass clazz, jlong handle) {
    if (handle == 0) return 0;
    return (jint) reinterpret_cast<SoundTouch *>(handle)->numSamples();
}

JNIEXPORT void JNICALL
Java_com_kmz_soundtouch_SoundTouchNative_nativeFlush(
        JNIEnv *env, jclass clazz, jlong handle) {
    if (handle == 0) return;
    reinterpret_cast<SoundTouch *>(handle)->flush();
}

JNIEXPORT void JNICALL
Java_com_kmz_soundtouch_SoundTouchNative_nativeDestroy(
        JNIEnv *env, jclass clazz, jlong handle) {
    if (handle == 0) return;
    delete reinterpret_cast<SoundTouch *>(handle);
}

} // extern "C"
