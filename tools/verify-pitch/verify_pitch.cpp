// verify_pitch.cpp
// Teste objetivo e independente de ouvido humano: gera um tom puro de
// frequência conhecida, passa pelo MESMO código SoundTouch que vai pro
// app (vendorizado em capacitor-soundtouch/), aplica +3 e -3 semitons, e
// mede matematicamente a frequência de saída (contagem de cruzamentos por
// zero) e a duração (contagem de amostras), comparando com o esperado.
#include <cmath>
#include <cstdio>
#include <vector>
#include "SoundTouch.h"

using namespace soundtouch;

const double PI = 3.14159265358979323846;

// Gera um tom senoidal puro em mono, float32, normalizado.
std::vector<float> generateTone(double freqHz, double durationSec, int sampleRate) {
    int numSamples = (int)(durationSec * sampleRate);
    std::vector<float> out(numSamples);
    for (int i = 0; i < numSamples; i++) {
        out[i] = 0.5f * (float)sin(2.0 * PI * freqHz * i / sampleRate);
    }
    return out;
}

// Estima a frequência dominante por contagem de cruzamentos de zero
// (subindo), ignorando os primeiros/últimos 10% das amostras pra evitar
// artefatos de borda/latência do algoritmo.
double estimateFrequency(const std::vector<float>& samples, int sampleRate) {
    int margin = (int)(samples.size() * 0.1);
    int start = margin;
    int end = (int)samples.size() - margin;
    if (end <= start) return 0.0;

    int crossings = 0;
    for (int i = start + 1; i < end; i++) {
        if (samples[i - 1] < 0.0f && samples[i] >= 0.0f) crossings++;
    }
    double durationSec = (double)(end - start) / sampleRate;
    return crossings / durationSec;
}

struct TestResult {
    float semitones;
    double expectedFreq;
    double measuredFreq;
    double freqErrorPercent;
    int inputSamples;
    int outputSamples;
    double durationErrorPercent;
    bool pass;
};

TestResult runTest(double inputFreq, float semitones, int sampleRate) {
    double durationSec = 3.0;
    std::vector<float> input = generateTone(inputFreq, durationSec, sampleRate);

    SoundTouch st;
    st.setChannels(1);
    st.setSampleRate(sampleRate);
    st.setPitchSemiTones(semitones);
    st.setSetting(SETTING_USE_QUICKSEEK, 0);
    st.setSetting(SETTING_USE_AA_FILTER, 1);

    st.putSamples(input.data(), (uint)input.size());

    std::vector<float> output;
    const int BUF = 4096;
    float buf[BUF];
    uint got;
    // Drena o que já estiver pronto ANTES do flush (mesmo padrão usado no
    // plugin Kotlin de produção, SoundTouchPlugin.kt/drainAvailable).
    while ((got = st.receiveSamples(buf, BUF)) > 0) {
        output.insert(output.end(), buf, buf + got);
    }
    st.flush();
    // Drena o restante (cauda final) depois do flush.
    while ((got = st.receiveSamples(buf, BUF)) > 0) {
        output.insert(output.end(), buf, buf + got);
    }

    double expectedFreq = inputFreq * pow(2.0, semitones / 12.0);
    double measuredFreq = estimateFrequency(output, sampleRate);
    double freqError = fabs(measuredFreq - expectedFreq) / expectedFreq * 100.0;

    double durationError = fabs((double)output.size() - (double)input.size())
                            / (double)input.size() * 100.0;

    TestResult r;
    r.semitones = semitones;
    r.expectedFreq = expectedFreq;
    r.measuredFreq = measuredFreq;
    r.freqErrorPercent = freqError;
    r.inputSamples = (int)input.size();
    r.outputSamples = (int)output.size();
    r.durationErrorPercent = durationError;
    // Tolerância: 2% na frequência (a detecção por zero-crossing tem ruído
    // de quantização), 5% na duração (SoundTouch tem alguma latência de
    // buffer interno nas bordas).
    r.pass = (freqError < 2.0) && (durationError < 5.0);
    return r;
}

int main() {
    const int sampleRate = 44100;
    const double baseFreq = 440.0; // Lá (A4) - nota de referência musical

    printf("=== Teste objetivo: SoundTouch preserva tempo e desloca o pitch corretamente? ===\n");
    printf("Tom de entrada: %.1f Hz (A4) a %d Hz de amostragem\n\n", baseFreq, sampleRate);

    float testSemitones[] = { -3, -2, -1, 0, 1, 2, 3 };
    bool allPass = true;

    for (float st : testSemitones) {
        TestResult r = runTest(baseFreq, st, sampleRate);
        allPass = allPass && r.pass;
        printf("Semitons: %+.0f | esperado: %7.2f Hz | medido: %7.2f Hz | erro freq: %5.2f%% | "
               "amostras in/out: %d/%d | erro duração: %5.2f%% | %s\n",
               r.semitones, r.expectedFreq, r.measuredFreq, r.freqErrorPercent,
               r.inputSamples, r.outputSamples, r.durationErrorPercent,
               r.pass ? "PASSOU" : "FALHOU");
    }

    printf("\n%s\n", allPass
        ? "RESULTADO FINAL: PASSOU - pitch muda como esperado E o tempo/duração é preservado."
        : "RESULTADO FINAL: FALHOU - ver detalhes acima.");

    return allPass ? 0 : 1;
}

