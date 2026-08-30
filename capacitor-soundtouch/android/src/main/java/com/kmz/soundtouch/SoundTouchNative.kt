package com.kmz.soundtouch

/**
 * Wrapper Kotlin de baixo nivel sobre a biblioteca nativa SoundTouch (LGPL 2.1).
 * Nao usar diretamente na UI - use SoundTouchPlugin.
 */
internal class SoundTouchNative(channels: Int, sampleRate: Int) {

    private var handle: Long = nativeCreate(channels, sampleRate)

    fun setPitchSemiTones(semitones: Float) {
        nativeSetPitchSemiTones(handle, semitones)
    }

    fun putSamples(samples: FloatArray, numSamples: Int) {
        nativePutSamples(handle, samples, numSamples)
    }

    fun receiveSamples(out: FloatArray, maxSamples: Int): Int {
        return nativeReceiveSamples(handle, out, maxSamples)
    }

    fun availableSamples(): Int = nativeAvailableSamples(handle)

    fun flush() {
        nativeFlush(handle)
    }

    fun destroy() {
        if (handle != 0L) {
            nativeDestroy(handle)
            handle = 0
        }
    }

    companion object {
        init {
            System.loadLibrary("soundtouch-jni")
        }

        @JvmStatic private external fun nativeCreate(channels: Int, sampleRate: Int): Long
        @JvmStatic private external fun nativeSetPitchSemiTones(handle: Long, semitones: Float)
        @JvmStatic private external fun nativePutSamples(handle: Long, samples: FloatArray, numSamples: Int)
        @JvmStatic private external fun nativeReceiveSamples(handle: Long, out: FloatArray, maxSamples: Int): Int
        @JvmStatic private external fun nativeAvailableSamples(handle: Long): Int
        @JvmStatic private external fun nativeFlush(handle: Long)
        @JvmStatic private external fun nativeDestroy(handle: Long)
    }
}
