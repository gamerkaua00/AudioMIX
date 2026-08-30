package com.kmz.soundtouch

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Plugin Capacitor "SoundTouchPitch".
 *
 * IMPORTANTE: processa em SESSÃO POR PEDAÇOS (chunks) em vez de receber o
 * áudio inteiro numa única chamada. Um áudio de alguns minutos em PCM
 * float32 intercalado facilmente passa de 50-100MB — mandar isso tudo de
 * uma vez pela ponte JS<->nativo do Capacitor (que serializa como
 * string/JSON) é lento, gasta memória em dobro (string base64 + bytes) dos
 * dois lados, e pode falhar silenciosamente em aparelhos com menos RAM.
 *
 * Fluxo esperado a partir do JS:
 *   1) createSession({ sampleRate, channels, semitones }) -> { sessionId }
 *   2) processChunk({ sessionId, pcm }) repetidamente, pedaço por pedaço -> { pcm }
 *   3) finishSession({ sessionId }) -> { pcm } (drena o restante e libera a sessão)
 */
@CapacitorPlugin(name = "SoundTouchPitch")
class SoundTouchPlugin : Plugin() {

    companion object {
        private val sessions = ConcurrentHashMap<String, SessionState>()
    }

    private class SessionState(val engine: SoundTouchNative, val channels: Int)

    @PluginMethod
    fun createSession(call: PluginCall) {
        try {
            val sampleRate = call.getInt("sampleRate")
            val channels = call.getInt("channels")
            val semitones = call.getFloat("semitones")
            if (sampleRate == null || channels == null || semitones == null) {
                call.reject("Parametros ausentes: sampleRate, channels, semitones")
                return
            }

            val engine = SoundTouchNative(channels, sampleRate)
            engine.setPitchSemiTones(semitones)

            val sessionId = UUID.randomUUID().toString()
            sessions[sessionId] = SessionState(engine, channels)

            val ret = JSObject()
            ret.put("sessionId", sessionId)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Falha ao criar sessão SoundTouch: ${e.message}", e)
        }
    }

    @PluginMethod
    fun processChunk(call: PluginCall) {
        try {
            val sessionId = call.getString("sessionId")
            val base64Pcm = call.getString("pcm")
            if (sessionId == null || base64Pcm == null) {
                call.reject("Parametros ausentes: sessionId, pcm")
                return
            }
            val session = sessions[sessionId]
                ?: run { call.reject("Sessão SoundTouch inválida/expirada: $sessionId"); return }

            val inputSamples = decodeBase64Float32(base64Pcm)
            val framesIn = inputSamples.size / session.channels

            session.engine.putSamples(inputSamples, framesIn)

            val outputBytes = drainAvailable(session.engine, session.channels, drainAll = false)
            val ret = JSObject()
            ret.put("pcm", Base64.encodeToString(outputBytes, Base64.NO_WRAP))
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Falha ao processar pedaço de áudio: ${e.message}", e)
        }
    }

    @PluginMethod
    fun finishSession(call: PluginCall) {
        try {
            val sessionId = call.getString("sessionId")
            if (sessionId == null) {
                call.reject("Parâmetro ausente: sessionId")
                return
            }
            val session = sessions.remove(sessionId)
                ?: run { call.reject("Sessão SoundTouch inválida/expirada: $sessionId"); return }

            session.engine.flush()
            val outputBytes = drainAvailable(session.engine, session.channels, drainAll = true)
            session.engine.destroy()

            val ret = JSObject()
            ret.put("pcm", Base64.encodeToString(outputBytes, Base64.NO_WRAP))
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Falha ao finalizar sessão SoundTouch: ${e.message}", e)
        }
    }

    private fun decodeBase64Float32(base64: String): FloatArray {
        val bytes = Base64.decode(base64, Base64.NO_WRAP)
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val floats = FloatArray(bytes.size / 4)
        buf.asFloatBuffer().get(floats)
        return floats
    }

    private fun drainAvailable(engine: SoundTouchNative, channels: Int, drainAll: Boolean): ByteArray {
        val chunkFrames = 4096
        val outChunk = FloatArray(chunkFrames * channels)
        val output = java.io.ByteArrayOutputStream()
        val outByteBuf = ByteBuffer.allocate(chunkFrames * channels * 4).order(ByteOrder.LITTLE_ENDIAN)

        while (true) {
            val available = engine.availableSamples()
            if (available <= 0) break
            if (!drainAll && available < chunkFrames) break

            val got = engine.receiveSamples(outChunk, chunkFrames)
            if (got <= 0) break

            outByteBuf.clear()
            outByteBuf.asFloatBuffer().put(outChunk, 0, got * channels)
            output.write(outByteBuf.array(), 0, got * channels * 4)
        }
        return output.toByteArray()
    }
}
