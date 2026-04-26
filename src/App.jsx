import React, { useState, useRef, useEffect } from 'react';
import * as Tone from 'tone';
import { 
  Upload, Play, Pause, Download, Share2, Edit2, Trash2, 
  MicOff, Settings2, FolderDown, Activity, Check,
  AlertCircle
} from 'lucide-react';

// --- UTILITÁRIO: Codificador WAV de Alta Fidelidade ---
function audioBufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numOfChan * 2;
  const bufferArray = new ArrayBuffer(44 + length);
  const view = new DataView(bufferArray);
  const channels = [];
  let sample, offset = 0, pos = 0;

  setUint32(0x46464952); setUint32(36 + length); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan); setUint16(numOfChan * 2);
  setUint16(16); setUint32(0x61746164); setUint32(length);

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  function setUint16(data) { view.setUint16(offset, data, true); offset += 2; }
  function setUint32(data) { view.setUint32(offset, data, true); offset += 4; }

  return new Blob([bufferArray], { type: 'audio/wav' });
}

export default function App() {
  const [activeTab, setActiveTab] = useState('studio');
  const [library, setLibrary] = useState([]);
  
  // Estado do Estúdio
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [pitch, setPitch] = useState(0); 
  const [removeVocals, setRemoveVocals] = useState(false);
  
  // Estados de Renderização
  const [isProcessing, setIsProcessing] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);

  // Referências do Motor Híbrido (Tone.js)
  const audioBufferRef = useRef(null);
  const playerRef = useRef(null);
  const pitchShiftRef = useRef(null);
  const bypassGainRef = useRef(null);
  const processedGainRef = useRef(null);

  // Limpa o áudio completamente ao trocar
  const cleanupAudio = () => {
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    if (playerRef.current) {
      playerRef.current.dispose();
      pitchShiftRef.current.dispose();
      bypassGainRef.current.dispose();
      processedGainRef.current.dispose();
    }
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setIsProcessing(true);
    setRenderProgress(0); // Usa a barra para o carregamento também!
    
    try {
      cleanupAudio();
      setFile(uploadedFile);
      setFileName(uploadedFile.name.replace(/\.[^/.]+$/, ""));
      setPitch(0);
      setRemoveVocals(false);
      setIsPlaying(false);

      await Tone.start(); // Acorda o sistema de áudio
      
      const arrayBuffer = await uploadedFile.arrayBuffer();
      const audioBuffer = await Tone.context.decodeAudioData(arrayBuffer);
      audioBufferRef.current = audioBuffer;

      // Monta o Grafo de Áudio com Tone.js (Efeito DJ Real-Time)
      playerRef.current = new Tone.Player(audioBuffer).sync().start(0);
      
      // Phase Vocoder Profissional (windowSize 0.1 evita robotização extrema)
      pitchShiftRef.current = new Tone.PitchShift({ pitch: 0, windowSize: 0.1 });
      
      // Separador Estéreo para Voz
      const split = new Tone.MidSideSplit();
      const merge = new Tone.MidSideMerge();
      const vocalEq = new Tone.EQ3({ low: 0, mid: -25, high: 0 }); // Mata as vozes no canal central
      
      // Roteamento
      bypassGainRef.current = new Tone.Gain(1).toDestination();
      processedGainRef.current = new Tone.Gain(0).toDestination();

      playerRef.current.connect(pitchShiftRef.current);
      
      // Caminho Original
      pitchShiftRef.current.connect(bypassGainRef.current);
      
      // Caminho Sem Voz
      pitchShiftRef.current.connect(split);
      split.mid.connect(vocalEq);
      vocalEq.connect(merge.mid);
      split.side.connect(merge.side);
      merge.connect(processedGainRef.current);

      // Desliga automaticamente ao chegar no fim da música
      Tone.Transport.scheduleOnce(() => {
        Tone.Transport.stop();
        Tone.Transport.seconds = 0;
        setIsPlaying(false);
      }, audioBuffer.duration);

    } catch (error) {
      alert("Erro ao ler o ficheiro MP3.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Aplica as mudanças de Tom INSTANTANEAMENTE
  useEffect(() => {
    if (pitchShiftRef.current) pitchShiftRef.current.pitch = pitch;
  }, [pitch]);

  // Aplica a remoção de voz INSTANTANEAMENTE
  useEffect(() => {
    if (bypassGainRef.current && processedGainRef.current) {
      bypassGainRef.current.gain.rampTo(removeVocals ? 0 : 1, 0.1);
      processedGainRef.current.gain.rampTo(removeVocals ? 1 : 0, 0.1);
    }
  }, [removeVocals]);

  const togglePlay = async () => {
    await Tone.start();
    if (isPlaying) {
      Tone.Transport.pause();
      setIsPlaying(false);
    } else {
      Tone.Transport.start();
      setIsPlaying(true);
    }
  };

  // --- O SEGREDO: RENDERIZAÇÃO HÍBRIDA (Anti-Travamento no Telemóvel) ---
  const processAndSave = async () => {
    if (!audioBufferRef.current) return;
    setIsProcessing(true);
    setRenderProgress(0);
    
    if (isPlaying) {
      Tone.Transport.pause();
      setIsPlaying(false);
    }

    try {
      const buffer = audioBufferRef.current;
      const duration = buffer.duration;
      const sampleRate = buffer.sampleRate;
      
      // Cria um ambiente fantasma (Offline)
      const offlineCtx = new window.OfflineAudioContext(2, duration * sampleRate, sampleRate);
      const offlineToneCtx = new Tone.Context(offlineCtx);
      
      // Salva o ambiente atual e injeta o Tone.js no ambiente fantasma
      const currentContext = Tone.getContext();
      Tone.setContext(offlineToneCtx);

      try {
        // Reconstrói a máquina no ambiente fantasma para a exportação
        const offPlayer = new Tone.Player(buffer);
        const offPitch = new Tone.PitchShift({ pitch: pitch, windowSize: 0.1 });
        const offSplit = new Tone.MidSideSplit();
        const offEq = new Tone.EQ3({ low: 0, mid: -25, high: 0 });
        const offMerge = new Tone.MidSideMerge();
        
        offPlayer.connect(offPitch);
        
        if (removeVocals) {
          offPitch.connect(offSplit);
          offSplit.mid.connect(offEq);
          offEq.connect(offMerge.mid);
          offSplit.side.connect(offMerge.side);
          offMerge.toDestination();
        } else {
          offPitch.toDestination();
        }
        
        offPlayer.start(0);

        // O milagre do fatiamento: Processa 5 segundos, respira e atualiza a barra
        const chunkStep = 5;
        for (let time = chunkStep; time < duration; time += chunkStep) {
          offlineCtx.suspend(time).then(async () => {
            setRenderProgress(Math.round((time / duration) * 100));
            await new Promise(r => setTimeout(r, 20)); // Liberta a memória para não travar
            offlineCtx.resume();
          });
        }

        const renderedNativeBuffer = await offlineCtx.startRendering();
        
        // Finaliza o ficheiro
        setRenderProgress(100);
        await new Promise(r => setTimeout(r, 100)); // Último respiro

        const wavBlob = audioBufferToWav(renderedNativeBuffer);
        const url = URL.createObjectURL(wavBlob);

        const newTrack = {
          id: Date.now().toString(),
          name: `${fileName} (Masterizado)`,
          url: url,
          blob: wavBlob,
          details: `Tom: ${pitch === 0 ? 'Orig' : pitch > 0 ? '+'+pitch : pitch} | Sem Voz: ${removeVocals ? 'Sim' : 'Não'}`
        };

        setLibrary([newTrack, ...library]);
        setActiveTab('library');
        
        // Limpa para a próxima música
        cleanupAudio();
        setFile(null);
        setPitch(0);
        setRemoveVocals(false);
      } finally {
        // SEMPRE devolve o controlo do Tone.js para o ambiente normal
        Tone.setContext(currentContext);
      }
    } catch (error) {
      console.error("Erro no processamento:", error);
      alert("Houve um erro. Tente uma música um pouco mais curta.");
    } finally {
      setIsProcessing(false);
      setRenderProgress(0);
    }
  };

  // --- AÇÕES DA BIBLIOTECA ---
  const handleShare = async (track) => {
    const fileToShare = new File([track.blob], `${track.name}.wav`, { type: 'audio/wav' });
    if (navigator.canShare && navigator.canShare({ files: [fileToShare] })) {
      try {
        await navigator.share({ title: track.name, files: [fileToShare] });
      } catch (err) { console.log("Partilha cancelada"); }
    } else {
      alert("O dispositivo não suporta envio nativo. Clique em Transferir.");
    }
  };

  const handleDownload = (track) => {
    const a = document.createElement('a');
    a.href = track.url;
    a.download = `${track.name}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleRename = (id, oldName) => {
    const newName = prompt("Renomear faixa:", oldName);
    if (newName && newName.trim() !== "") {
      setLibrary(library.map(t => t.id === id ? { ...t, name: newName.trim() } : t));
    }
  };

  const handleDelete = (id) => {
    if(confirm("Remover da biblioteca?")) {
        setLibrary(library.filter(t => t.id !== id));
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-gray-100 font-sans flex flex-col items-center">
      
      {/* Cabeçalho */}
      <header className="w-full max-w-md p-5 flex justify-between items-center bg-[#111115] border-b border-gray-800 shadow-md sticky top-0 z-20">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent flex items-center gap-2">
            <Activity className="text-blue-500" size={20} /> Estúdio Playback
          </h1>
          <p className="text-[10px] text-gray-500 font-medium tracking-widest uppercase">Motor Phase Vocoder (Tone.js)</p>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="flex-1 w-full max-w-md p-5 overflow-y-auto pb-24">
        
        {activeTab === 'studio' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            
            {!file ? (
              <label className="flex flex-col items-center justify-center w-full h-72 border-2 border-gray-800 border-dashed rounded-[2rem] cursor-pointer bg-[#15151a] hover:bg-[#1a1a20] transition-colors group">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  {isProcessing ? (
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                  ) : (
                    <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Upload className="w-8 h-8 text-blue-400" />
                    </div>
                  )}
                  <p className="mb-2 text-base text-gray-200 font-bold">{isProcessing ? 'A Analisar Áudio...' : 'Adicionar Louvor (MP3)'}</p>
                </div>
                <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} disabled={isProcessing} />
              </label>
            ) : (
              <div className="bg-[#15151a] p-5 rounded-[2rem] shadow-xl border border-gray-800/50 relative">
                
                <div className="text-center mb-6">
                  <h2 className="text-lg font-bold text-gray-100 truncate px-4">{fileName}</h2>
                  <p className="text-xs text-blue-400 font-medium mt-1 flex justify-center items-center gap-1">
                    <Check size={12}/> Faixa carregada no Tone.js
                  </p>
                </div>

                <div className="flex justify-center mb-8">
                  <button 
                    onClick={togglePlay}
                    disabled={isProcessing}
                    className="w-20 h-20 flex items-center justify-center bg-gradient-to-tr from-blue-600 to-indigo-500 hover:scale-105 active:scale-95 text-white rounded-full shadow-[0_0_30px_rgba(79,70,229,0.3)] transition-all disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-2" />}
                  </button>
                </div>

                <div className="bg-[#0a0a0c] p-4 rounded-3xl mb-4 border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl transition-colors ${removeVocals ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-400'}`}>
                        <MicOff size={22} />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm">Remover Voz</h3>
                        <p className="text-[11px] text-gray-500 leading-tight mt-0.5">Separação Mid/Side Profissional</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={removeVocals} onChange={() => setRemoveVocals(!removeVocals)} disabled={isProcessing} />
                      <div className="w-12 h-6 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>
                </div>

                <div className="bg-[#0a0a0c] p-4 rounded-3xl border border-gray-800">
                  <div className="mb-3">
                    <h3 className="font-bold text-sm">Seletor de Tom</h3>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                      <AlertCircle size={10} /> Velocidade Preservada (Tone.js)
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-1">
                    {[-3, -2, -1, 0, 1, 2, 3].map((val) => (
                      <button
                        key={val}
                        onClick={() => setPitch(val)}
                        disabled={isProcessing}
                        className={`py-3 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition-all
                          ${pitch === val 
                            ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20 scale-105 z-10' 
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          } disabled:opacity-50 disabled:hover:scale-100`}
                      >
                        {val > 0 ? `+${val}` : val === 0 ? 'Orig' : val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                  {isProcessing ? (
                    <div className="w-full bg-[#0a0a0c] rounded-2xl p-4 flex flex-col items-center gap-3 border border-gray-800 shadow-inner">
                      <div className="flex justify-between w-full text-xs font-extrabold text-blue-400">
                        <span className="animate-pulse">A Renderizar no Telemóvel...</span>
                        <span>{renderProgress}%</span>
                      </div>
                      <div className="w-full bg-gray-800/80 rounded-full h-3 overflow-hidden shadow-inner border border-gray-900">
                        <div 
                          className="bg-gradient-to-r from-blue-600 via-blue-400 to-indigo-500 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                          style={{ width: `${renderProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={processAndSave}
                      className="w-full py-4 bg-white hover:bg-gray-100 text-gray-950 rounded-2xl text-sm font-extrabold transition-colors flex justify-center items-center gap-2 shadow-xl active:scale-[0.98]"
                    >
                      Exportar Playback <Download size={18} strokeWidth={2.5} />
                    </button>
                  )}

                  <button 
                    onClick={() => { cleanupAudio(); setFile(null); }}
                    disabled={isProcessing}
                    className="w-full py-3 bg-transparent text-gray-400 hover:text-white rounded-2xl text-sm font-semibold transition-colors disabled:opacity-30"
                  >
                    Trocar Música
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ABA BIBLIOTECA */}
        {activeTab === 'library' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {library.length === 0 ? (
              <div className="text-center py-16 px-6 bg-[#15151a] rounded-[2rem] border border-gray-800/50">
                <div className="w-16 h-16 bg-gray-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FolderDown className="w-8 h-8 text-gray-500" />
                </div>
                <h3 className="text-gray-200 font-bold mb-1">Nenhum playback salvo</h3>
                <p className="text-sm text-gray-500">Volte ao estúdio, processe um louvor e ele aparecerá aqui.</p>
                <button 
                  onClick={() => setActiveTab('studio')}
                  className="mt-6 px-6 py-2.5 bg-blue-500/10 text-blue-400 rounded-full text-sm font-bold hover:bg-blue-500/20 transition-colors"
                >
                  Abrir Estúdio
                </button>
              </div>
            ) : (
              library.map((track) => (
                <div key={track.id} className="bg-[#15151a] p-4 rounded-[1.5rem] border border-gray-800/50 shadow-lg">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0 pr-4">
                      <h3 className="font-bold text-base truncate text-gray-100">{track.name}</h3>
                      <p className="text-[11px] font-medium text-blue-400 mt-0.5 bg-blue-500/10 inline-block px-2 py-0.5 rounded-md border border-blue-500/20">
                        {track.details}
                      </p>
                    </div>
                    <button onClick={() => handleDelete(track.id)} className="text-gray-600 hover:text-red-400 p-2 transition-colors">
                      <Trash2 size={18} />
                    </button>
                  </div>
                  
                  <audio controls src={track.url} className="w-full h-11 mb-4 rounded-lg bg-gray-900 
                    [&::-webkit-media-controls-panel]:bg-[#0a0a0c] 
                    [&::-webkit-media-controls-current-time-display]:text-blue-400 
                    [&::-webkit-media-controls-time-remaining-display]:text-gray-400" 
                  />
                  
                  <div className="flex gap-2">
                    <button onClick={() => handleRename(track.id, track.name)} className="flex-1 py-2.5 bg-[#0a0a0c] hover:bg-gray-800 rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-gray-300 border border-gray-800 transition-colors">
                      <Edit2 size={14} /> Renomear
                    </button>
                    <button onClick={() => handleShare(track)} className="flex-[1.5] py-2.5 bg-green-500 hover:bg-green-400 text-gray-950 rounded-xl flex items-center justify-center gap-2 text-xs font-extrabold shadow-lg shadow-green-500/20 transition-all active:scale-95">
                      <Share2 size={16} /> Enviar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Navegação Fixa Inferior */}
      <nav className="fixed bottom-0 w-full max-w-md bg-[#111115]/90 backdrop-blur-xl border-t border-gray-800/80 flex justify-around p-2 pb-safe-area shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
        <button 
          onClick={() => setActiveTab('studio')}
          className={`flex flex-col items-center gap-1.5 p-3 w-28 rounded-2xl transition-all ${activeTab === 'studio' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <Settings2 size={22} />
          <span className="text-[10px] font-bold tracking-widest uppercase">Estúdio</span>
        </button>
        <button 
          onClick={() => setActiveTab('library')}
          className={`flex flex-col items-center gap-1.5 p-3 w-28 rounded-2xl transition-all relative ${activeTab === 'library' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <FolderDown size={22} />
          <span className="text-[10px] font-bold tracking-widest uppercase">Salvos</span>
          {library.length > 0 && (
            <span className="absolute top-2.5 right-7 w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,1)] border border-[#111115]"></span>
          )}
        </button>
      </nav>
      
    </div>
  );
}