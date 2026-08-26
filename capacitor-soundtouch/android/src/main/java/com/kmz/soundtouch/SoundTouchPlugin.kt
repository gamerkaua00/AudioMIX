package com.kmz.soundtouch

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Plugin Capacitor "SoundTouchPitch".
 *
 * Recebe PCM float32 intercalado (o mesmo formato que AudioBuffer.getChannelData
 * produz no navegador) em base64, aplica pitch-shift com tempo preservado via
 * SoundTouch (LGPL 2.1), e devolve o PCM processado, tambem em base64.
 *
 * Usado no fluxo de EXPORTACAO (processAndSave) do AudioMIX, onde qualidade
 * importa mais que latencia em tempo real.
 */
@CapacitorPlugin(name = "SoundTouchPitch")
class SoundTouchPlugin : Plugin() {

    @PluginMethod
    fun process(call: PluginCall) {
        try {
            val base64Pcm = call.getString("pcm")
            val sampleRate = call.getInt("sampleRate")
            val channels = call.getInt("channels")
            val semitones = call.getFloat("semitones")

            if (base64Pcm == null || sampleRate == null || channels == null || semitones == null) {
                call.reject("Parametros ausentes: pcm, sampleRate, channels, semitones sao obrigatorios")
                return
            }

            val inputBytes = Base64.decode(base64Pcm, Base64.NO_WRAP)
            val inputBuffer = ByteBuffer.wrap(inputBytes).order(ByteOrder.LITTLE_ENDIAN)
            val totalFloats = inputBytes.size / 4
            val inputSamples = FloatArray(totalFloats)
            inputBuffer.asFloatBuffer().get(inputSamples)

            val engine = SoundTouchNative(channels, sampleRate)
            engine.setPitchSemiTones(semitones)

            val framesIn = totalFloats / channels
            val chunkFrames = 4096
            val chunkBuf = FloatArray(chunkFrames * channels)
            val outChunk = FloatArray(chunkFrames * channels)

            val output = java.io.ByteArrayOutputStream(inputBytes.size)
            val outByteBuf = ByteBuffer.allocate(chunkFrames * channels * 4).order(ByteOrder.LITTLE_ENDIAN)

            var frameOffset = 0
            while (frameOffset < framesIn) {
                val framesThisChunk = minOf(chunkFrames, framesIn - frameOffset)
                val samplesThisChunk = framesThisChunk * channels
                System.arraycopy(inputSamples, frameOffset * channels, chunkBuf, 0, samplesThisChunk)

                engine.putSamples(chunkBuf, framesThisChunk)
                drainAvailable(engine, outChunk, chunkFrames, channels, output, outByteBuf)

                frameOffset += framesThisChunk
            }

            engine.flush()
            drainAvailable(engine, outChunk, chunkFrames, channels, output, outByteBuf, drainAll = true)
            engine.destroy()

            val resultBase64 = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
            val ret = JSObject()
            ret.put("pcm", resultBase64)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Falha no processamento SoundTouch: ${e.message}", e)
        }
    }

    private fun drainAvailable(
        engine: SoundTouchNative,
        outChunk: FloatArray,
        chunkFrames: Int,
        channels: Int,
        output: java.io.ByteArrayOutputStream,
        outByteBuf: ByteBuffer,
        drainAll: Boolean = false
    ) {
        while (true) {
            val available = engine.availableSamples()
            if (available <= 0) break
            if (!drainAll && available < chunkFrames) break

            val got = engine.receiveSamples(outChunk, chunkFrames)
            if (got <= 0) break

            outByteBuf.clear()
            outByteBuf.asFloatBuffer().put(outChunk, 0, got * channels)
            val byteCount = got * channels * 4
            output.write(outByteBuf.array(), 0, byteCount)
        }
    }
}
