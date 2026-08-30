# Verificação objetiva do motor de pitch shift

`verify_pitch.cpp` compila e testa o **mesmo código-fonte C++** que roda no
app (SoundTouch, vendorizado em `capacitor-soundtouch/android/.../soundtouch/`)
diretamente no PC, sem precisar de Android. Gera um tom puro de 440 Hz (Lá),
aplica cada deslocamento de -3 a +3 semitons, e mede matematicamente
(contagem de cruzamentos por zero) se a frequência de saída bate com o
esperado E se a duração do áudio foi preservada.

Roda automaticamente no CI (`.github/workflows/build-apk.yml`, job
`verify-audio-engine`) antes de qualquer build Android — se o motor de
áudio regredir, o build inteiro falha rápido, sem gastar tempo compilando
o APK.

## Rodando localmente

```bash
SRC=capacitor-soundtouch/android/src/main/cpp/soundtouch
g++ -std=c++14 -O2 -DANDROID -DSOUNDTOUCH_FLOAT_SAMPLES=1 -DSOUNDTOUCH_DISABLE_X86_OPTIMIZATIONS=1 \
  -I "$SRC" \
  tools/verify-pitch/verify_pitch.cpp \
  "$SRC"/SoundTouch.cpp "$SRC"/TDStretch.cpp "$SRC"/RateTransposer.cpp \
  "$SRC"/AAFilter.cpp "$SRC"/FIRFilter.cpp "$SRC"/FIFOSampleBuffer.cpp \
  "$SRC"/InterpolateCubic.cpp "$SRC"/InterpolateLinear.cpp "$SRC"/InterpolateShannon.cpp \
  "$SRC"/cpu_detect_x86.cpp \
  -o /tmp/verify_pitch
/tmp/verify_pitch
```

A flag `-DANDROID` faz o compilador seguir exatamente o mesmo caminho de
código que o build real do Android usa (ver `STTypes.h`), então este teste
reflete fielmente o que roda no APK.
