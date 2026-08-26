import { registerPlugin } from '@capacitor/core';

/**
 * SoundTouchPitch - pitch shift nativo com tempo preservado (Android, SoundTouch/LGPL).
 *
 * .process({ pcm, sampleRate, channels, semitones }) -> { pcm }
 *   pcm: string base64 de Float32 intercalado little-endian (mesmo layout do
 *        AudioBuffer.getChannelData intercalado manualmente).
 *   Retorna o PCM processado no mesmo formato, com o pitch alterado e a MESMA
 *   duração/número de amostras (aprox.) do áudio original.
 */
const SoundTouchPitch = registerPlugin('SoundTouchPitch');

export default SoundTouchPitch;
