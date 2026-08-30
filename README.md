# AudioMIX

App Android para cantores adaptarem o tom de playbacks/MP3s à sua extensão vocal,
sem alterar a velocidade do áudio. Feito com React + Vite + Capacitor.

## Funcionalidades

- Transposição de tom de -3 a +3 semitons, com tempo preservado (motor nativo SoundTouch)
- EQ de 3 bandas (graves / médios / agudos) + compressor
- Atenuador de vocais (para faixas estéreo)
- Biblioteca local (IndexedDB) com renomear / organizar por playlist
- Exportação para MP3 e partilha nativa (WhatsApp, Telegram, e-mail, etc.)
- 100% offline: nenhum áudio é enviado para servidores

## Arquitetura

```
src/App.jsx              -> UI + lógica de áudio (Web Audio API)
capacitor-soundtouch/     -> Plugin Capacitor nativo (Android) que expõe o
                             pitch-shift real via SoundTouch Library (JNI/C++)
.github/workflows/        -> CI: builda o APK a cada push/PR
```

O motor de pitch-shift roda em C++ nativo (não em JS) para ter qualidade e
performance adequadas em dispositivos móveis. Ver `capacitor-soundtouch/README`
(se existir) ou os comentários em `App.jsx` (`applyNativePitchShift`) para
detalhes de como o PCM trafega entre JS e o código nativo.

## Rodando localmente

```bash
npm install
npm run dev          # preview no navegador (sem plugin nativo - ver nota abaixo)
```

> **Nota:** no navegador (`npm run dev`), o pitch-shift nativo não está
> disponível (é exclusivo do Android via Capacitor). A exportação mostra um
> aviso e sai sem alteração de tom nesse modo — use um APK real para testar
> a funcionalidade completa.

## Gerando o APK

O jeito mais simples é deixar o GitHub Actions (`.github/workflows/build-apk.yml`)
compilar automaticamente a cada push/PR. Ele:

1. Instala dependências e builda o React (`npm run build`)
2. Monta o projeto Android via Capacitor (`cap add android` + `cap sync android`)
3. Compila o APK (`./gradlew assembleDebug`)
4. Publica em **Releases** (push na `main`) ou como **artifact** (PRs/branches de teste)

Para compilar localmente é preciso Android SDK + NDK instalados:

```bash
npm run android:build   # vite build + cap sync android
cd android && ./gradlew assembleDebug
```

## Licenças de terceiros

- **SoundTouch Library** (pitch-shift nativo) — LGPL-3.0/LGPL-2.1, © Olli Parviainen.
  Ver `capacitor-soundtouch/android/src/main/cpp/soundtouch/LICENSE-SOUNDTOUCH-LGPL.txt`.
- **lamejs** (codificador MP3) — LGPL-3.0, © zhuker/lamejs.

Ambas são usadas como bibliotecas dinamicamente vinculadas/importadas, conforme
permitido pela LGPL, sem exigir que o código do AudioMIX seja aberto.
