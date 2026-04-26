import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Play, Pause, Download, Share2, Edit2, Trash2, 
  MicOff, Settings2, FolderDown, Activity, Check,
  AlertCircle, Sliders, Scissors, Plus, ListMusic
} from 'lucide-react';

// ==========================================
// 1. BASE DE DADOS LOCAL (IndexedDB)
// Mantém as músicas salvas mesmo fechando o App
// ==========================================
const DB_NAME = 'EstudioPlaybackDB';
const STORE_NAME = 'library';

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveTrackToDB = async (track) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(track);
  return new Promise((resolve) => {
    tx.oncomplete = resolve;
  });
};

const getLibraryFromDB = async () => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
  });
};

const deleteTrackFromDB = async (id) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  return new Promise((resolve) => {
    tx.oncomplete = resolve;
  });
};

// ==========================================
// 2. CODIFICADOR MP3 ASSÍNCRONO (Ultra Leve)
// Requer lamejs injetado dinamicamente
// ==========================================
async function encodeMP3Async(buffer, onProgress) {
  if (!window.lamejs) throw new Error("Aguarde, codificador MP3 a carregar...");
  
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  // Qualidade de estúdio (128kbps) para MP3
  const mp3encoder = new window.lamejs.Mp3Encoder(channels, sampleRate, 128); 
  const mp3Data = [];

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;
  const sampleBlockSize = 1152; // Padrão do MP3

  let pos = 0;
  return new Promise((resolve) => {
    function processChunk() {
      // Processa em blocos grandes para ser rápido, mas não travar
      const end = Math.min(pos + sampleBlockSize * 10, buffer.length); 
      const leftChunk = new Int16Array(end - pos);
      const rightChunk = new Int16Array(end - pos);

      // Converte sinal para o codificador MP3
      for (let i = 0; i < end - pos; i++) {
        leftChunk[i] = left[pos + i] * 32767.5;
        rightChunk[i] = right[pos + i] * 32767.5;
      }

      const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) mp3Data.push(mp3buf);

      pos = end;

      if (pos < buffer.length) {
        onProgress(Math.round((pos / buffer.length) * 100));
        setTimeout(processChunk, 10); // Pausa de 10ms (Anti-Crash do Android)
      } else {
        const flushBuf = mp3encoder.flush();
        if (flushBuf.length > 0) mp3Data.push(flushBuf);
        onProgress(100);
        resolve(new Blob(mp3Data, { type: 'audio/mp3' }));
      }
    }
    processChunk();
  });
}

// ==========================================
// 3. APLICAÇÃO PRINCIPAL (APP)
// ==========================================
export default function App() {
  const [activeTab, setActiveTab] = useState('studio');
  const [library, setLibrary] = useState([]);
  const [activePlaylist, setActivePlaylist] = useState('Todas');
  
  // Estados Globais de Edição
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Controles do Estúdio Básico
  const [pitch, setPitch] = useState(0); 
  const [removeVocals, setRemoveVocals] = useState(false);
  
  // Controles do Estúdio PRO
  const [bass, setBass] = useState(0);
  const [treble, setTreble] = useState(0);

  // Controles de Reprodução (Seeker & Loop)
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loopA, setLoopA] = useState(null);
  const [loopB, setLoopB] = useState(null);
  
  // Progresso de Renderização
  const [isProcessing, setIsProcessing] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);

  // Referências do Motor WebAudio API
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const audioBufferRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  
  const startTimeRef = useRef(0);
  const pausedAtRef = useRef(0);

  // 1. Carregar Script do LameJS (Para MP3) e Base de Dados Inicial
  useEffect(() => {
    // Injeta a biblioteca MP3 dinamicamente (para não precisar de npm install)
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";
    document.body.appendChild(script);

    // Carrega músicas guardadas
    getLibraryFromDB().then(tracks => {
      // O blob salvo na DB precisa de um novo URL a cada inicialização da app
      const tracksComUrl = tracks.map(t => ({
        ...t,
        url: URL.createObjectURL(t.blob)
      }));
      setLibrary(tracksComUrl.reverse());
    });
  }, []);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setFileName(uploadedFile.name.replace(/\.[^/.]+$/, ""));
    stopPreview(); 
    
    // Reseta Controles
    setPitch(0); setRemoveVocals(false); setBass(0); setTreble(0);
    setLoopA(null); setLoopB(null); setCurrentTime(0);
    pausedAtRef.current = 0;

    initAudioContext();
    const arrayBuffer = await uploadedFile.arrayBuffer();
    const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
    audioBufferRef.current = audioBuffer;
    setDuration(audioBuffer.duration);
  };

  // --- MOTOR DE ÁUDIO HD (Graves, Agudos, Voz, Tom e Analisador) ---
  const applyAudioRouting = (ctx, source, isOffline = false) => {
    const playbackRate = Math.pow(2, pitch / 12);
    source.playbackRate.value = playbackRate;

    // Filtros PRO (Graves e Agudos)
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 250;
    bassFilter.gain.value = bass;

    const trebleFilter = ctx.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 4000;
    trebleFilter.gain.value = treble;

    source.connect(bassFilter);
    bassFilter.connect(trebleFilter);
    let finalOutput = trebleFilter;

    // Filtro Básico (Remover Voz - Beta)
    if (removeVocals && audioBufferRef.current.numberOfChannels > 1) {
      const splitter = ctx.createChannelSplitter(2);
      trebleFilter.connect(splitter);

      const mid = ctx.createGain(); mid.gain.value = 0.5;
      splitter.connect(mid, 0); splitter.connect(mid, 1);

      const sideL = ctx.createGain(); sideL.gain.value = 0.5;
      const sideR = ctx.createGain(); sideR.gain.value = -0.5;
      splitter.connect(sideL, 0); splitter.connect(sideR, 1);
      const sideSum = ctx.createGain();
      sideL.connect(sideSum); sideR.connect(sideSum);

      const eq1 = ctx.createBiquadFilter(); eq1.type = 'peaking'; eq1.frequency.value = 1200; eq1.Q.value = 0.7; eq1.gain.value = -22;
      mid.connect(eq1);
      const eq2 = ctx.createBiquadFilter(); eq2.type = 'peaking'; eq2.frequency.value = 3500; eq2.Q.value = 1.0; eq2.gain.value = -16;
      eq1.connect(eq2);

      const merger = ctx.createChannelMerger(2);
      const outL = ctx.createGain(); eq2.connect(outL); sideSum.connect(outL); outL.connect(merger, 0, 0);
      const outR = ctx.createGain(); eq2.connect(outR); 
      const sideInvert = ctx.createGain(); sideInvert.gain.value = -1; 
      sideSum.connect(sideInvert); sideInvert.connect(outR); outR.connect(merger, 0, 1);

      finalOutput = merger;
    }

    // Analisador para Efeito Visual (Apenas quando não está offline)
    if (!isOffline) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      finalOutput.connect(analyser);
      analyserRef.current = analyser;
    }

    return finalOutput;
  };

  // --- REPRODUTOR E VISUALIZADOR ---
  const drawVisualizer = () => {
    if (!canvasRef.current || !analyserRef.current || !isPlaying) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, width, height);
    
    const barWidth = (width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    for(let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i] / 2.5;
      
      // Degrade Futurista
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#3b82f6'); // Azul
      gradient.addColorStop(1, '#6366f1'); // Indigo

      ctx.fillStyle = gradient;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
    
    animationRef.current = requestAnimationFrame(drawVisualizer);
  };

  const updateSeekerAndLoop = () => {
    if (!audioContextRef.current || !isPlaying) return;
    
    const ctx = audioContextRef.current;
    const playbackRate = Math.pow(2, pitch / 12);
    // Tempo atual = (Tempo do contexto - tempo que começou) * velocidade + de onde pausou
    let current = ((ctx.currentTime - startTimeRef.current) * playbackRate) + pausedAtRef.current;
    
    // Lógica do LOOP A-B
    if (loopB !== null && current >= loopB) {
      seekTo(loopA || 0);
      return; // Previne atualizar o frame após saltar
    }

    if (current >= duration) {
      setIsPlaying(false);
      setCurrentTime(duration);
      pausedAtRef.current = 0;
      return;
    }

    setCurrentTime(current);
    if(isPlaying) requestAnimationFrame(updateSeekerAndLoop);
  };

  const playPreview = () => {
    if (!audioBufferRef.current) return;
    initAudioContext();
    const ctx = audioContextRef.current;

    if (sourceNodeRef.current) sourceNodeRef.current.disconnect();

    const source = ctx.createBufferSource();
    source.buffer = audioBufferRef.current;
    
    const finalNode = applyAudioRouting(ctx, source);
    finalNode.connect(ctx.destination);
    
    source.start(0, pausedAtRef.current);
    const playbackRate = Math.pow(2, pitch / 12);
    startTimeRef.current = ctx.currentTime;
    
    sourceNodeRef.current = source;
    setIsPlaying(true);
    
    // Inicia a animação das ondas e a barra de tempo
    if(animationRef.current) cancelAnimationFrame(animationRef.current);
    drawVisualizer();
    requestAnimationFrame(updateSeekerAndLoop);
  };

  const stopPreview = () => {
    if (sourceNodeRef.current && isPlaying) {
      sourceNodeRef.current.stop();
      setIsPlaying(false);
      if(animationRef.current) cancelAnimationFrame(animationRef.current);
      
      const ctx = audioContextRef.current;
      const playbackRate = Math.pow(2, pitch / 12);
      pausedAtRef.current = pausedAtRef.current + ((ctx.currentTime - startTimeRef.current) * playbackRate);
    }
  };

  const togglePlay = () => {
    if (isPlaying) stopPreview();
    else playPreview();
  };

  const seekTo = (time) => {
    const wasPlaying = isPlaying;
    stopPreview();
    pausedAtRef.current = parseFloat(time);
    setCurrentTime(pausedAtRef.current);
    if (wasPlaying) playPreview();
  };

  useEffect(() => {
    if (isPlaying) {
      stopPreview();
      setTimeout(() => playPreview(), 30);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch, removeVocals, bass, treble]);

  // --- RENDERIZAÇÃO MP3 ASSÍNCRONA ---
  const processAndSave = async () => {
    if (!audioBufferRef.current) return;
    if (!window.lamejs) { alert("Aguarde um segundo, carregando motor MP3..."); return; }
    
    setIsProcessing(true);
    setRenderProgress(0);
    stopPreview();

    try {
      const originalBuffer = audioBufferRef.current;
      const playbackRate = Math.pow(2, pitch / 12);
      const newDuration = originalBuffer.duration / playbackRate;
      
      const offlineCtx = new window.OfflineAudioContext(
        originalBuffer.numberOfChannels, 
        newDuration * originalBuffer.sampleRate, 
        originalBuffer.sampleRate
      );

      const source = offlineCtx.createBufferSource();
      source.buffer = originalBuffer;

      const finalNode = applyAudioRouting(offlineCtx, source, true);
      finalNode.connect(offlineCtx.destination);
      source.start(0);

      setRenderProgress(5); 
      const renderedBuffer = await offlineCtx.startRendering();
      
      // Converte para MP3 usando o motor injetado
      const mp3Blob = await encodeMP3Async(renderedBuffer, (percent) => {
        setRenderProgress(Math.max(5, percent)); 
      });

      const url = URL.createObjectURL(mp3Blob);

      const newTrack = {
        id: Date.now().toString(),
        name: `${fileName} (Editado)`,
        url: url,
        blob: mp3Blob,
        playlist: 'Músicas Originais',
        details: `Tom: ${pitch === 0 ? 'Orig' : pitch} | MP3 | PRO`
      };

      // Guarda na Base de Dados e na Tela
      await saveTrackToDB(newTrack);
      setLibrary([newTrack, ...library]);
      setActiveTab('library');
      
      // Limpa estúdio
      setFile(null); setPitch(0); setRemoveVocals(false); setBass(0); setTreble(0);
      setLoopA(null); setLoopB(null); setCurrentTime(0); pausedAtRef.current = 0;
    } catch (error) {
      console.error(error);
      alert("Houve um erro. Tente novamente.");
    } finally {
      setIsProcessing(false);
      setRenderProgress(0);
    }
  };

  // --- AÇÕES DA BIBLIOTECA E PLAYLISTS ---
  const handleShare = async (track) => {
    const fileToShare = new File([track.blob], `${track.name}.mp3`, { type: 'audio/mp3' });
    if (navigator.canShare && navigator.canShare({ files: [fileToShare] })) {
      try {
        await navigator.share({ title: track.name, files: [fileToShare] });
      } catch (err) { console.log("Partilha cancelada"); }
    } else {
      alert("O seu dispositivo não suporta. Clique para ouvir/baixar.");
    }
  };

  const handleRename = async (id, oldName) => {
    const newName = prompt("Renomear faixa:", oldName);
    if (newName && newName.trim() !== "") {
      const track = library.find(t => t.id === id);
      track.name = newName.trim();
      await saveTrackToDB(track);
      setLibrary([...library]);
    }
  };

  const handleChangePlaylist = async (id) => {
    const pName = prompt("Digite o nome da Playlist (ex: Culto Domingo):", "Nova Playlist");
    if (pName && pName.trim() !== "") {
      const track = library.find(t => t.id === id);
      track.playlist = pName.trim();
      await saveTrackToDB(track);
      setLibrary([...library]);
    }
  };

  const handleDelete = async (id) => {
    if(confirm("Remover esta música da biblioteca permanentemente?")) {
        await deleteTrackFromDB(id);
        setLibrary(library.filter(t => t.id !== id));
    }
  };

  const formatTime = (time) => {
    if(isNaN(time)) return "00:00";
    const min = Math.floor(time / 60).toString().padStart(2, '0');
    const sec = Math.floor(time % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  };

  const playlistsDisponiveis = ['Todas', ...new Set(library.map(t => t.playlist || 'Sem Playlist'))];
  const bibliotecaFiltrada = activePlaylist === 'Todas' ? library : library.filter(t => t.playlist === activePlaylist);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-gray-100 font-sans flex flex-col items-center select-none">
      
      {/* Header Fixo */}
      <header className="w-full max-w-md p-5 pt-safe-area flex justify-between items-center bg-[#111115] border-b border-gray-800 shadow-md sticky top-0 z-20">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent flex items-center gap-2">
            <Activity className="text-blue-500" size={20} /> AudioMIX
          </h1>
          <p className="text-[10px] text-gray-500 font-medium tracking-widest uppercase mt-0.5">MP3 Engine • V2.0</p>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="flex-1 w-full max-w-md p-5 overflow-y-auto pb-28">
        
        {/* ABA 1: ESTÚDIO BÁSICO */}
        {activeTab === 'studio' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {!file ? (
              <label className="flex flex-col items-center justify-center w-full h-80 border-2 border-gray-800 border-dashed rounded-[2rem] cursor-pointer bg-[#15151a] hover:border-blue-500/50 transition-all shadow-inner">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center mb-6">
                    <Upload className="w-8 h-8 text-blue-400" />
                  </div>
                  <h2 className="mb-2 text-lg text-gray-100 font-extrabold tracking-tight">Estúdio Básico</h2>
                  <p className="text-sm text-gray-500 text-center px-8">Toque para selecionar um áudio.</p>
                </div>
                <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} disabled={isProcessing} />
              </label>
            ) : (
              <div className="bg-[#15151a] p-5 rounded-[2rem] shadow-xl border border-gray-800/50 relative">
                
                {/* Visualizador de Ondas Sonoras */}
                <div className="w-full h-24 bg-[#0a0a0c] rounded-2xl mb-6 flex items-end justify-center overflow-hidden border border-gray-800 relative shadow-inner">
                  <div className="absolute top-2 left-3 text-[10px] text-gray-600 font-bold uppercase tracking-widest flex items-center gap-1">
                    <Activity size={10}/> Visualizador
                  </div>
                  <canvas ref={canvasRef} width="300" height="80" className="w-full h-full opacity-80" />
                </div>

                <div className="text-center mb-4">
                  <h2 className="text-sm font-bold text-gray-100 truncate px-4">{fileName}</h2>
                </div>

                {/* Seeker (Barra de Tempo) e Loop */}
                <div className="mb-8">
                  <div className="flex justify-between text-[10px] text-gray-400 font-bold mb-2">
                    <span>{formatTime(currentTime)}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setLoopA(loopA === null ? currentTime : null)} className={`px-2 py-0.5 rounded ${loopA !== null ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-500'}`}>A</button>
                      <button onClick={() => setLoopB(loopB === null ? currentTime : null)} className={`px-2 py-0.5 rounded ${loopB !== null ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-500'}`}>B</button>
                    </div>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <input 
                    type="range" min="0" max={duration || 100} value={currentTime} 
                    onChange={(e) => seekTo(e.target.value)}
                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  {(loopA !== null || loopB !== null) && (
                    <div className="text-center mt-2 text-[10px] text-blue-400">
                      <Scissors size={10} className="inline mr-1"/> Modo Loop Ativo
                    </div>
                  )}
                </div>

                {/* Player */}
                <div className="flex justify-center mb-8 relative">
                  <div className="absolute inset-0 bg-blue-500/10 blur-xl rounded-full scale-150"></div>
                  <button 
                    onClick={togglePlay} disabled={isProcessing}
                    className="relative w-20 h-20 flex items-center justify-center bg-gradient-to-tr from-blue-600 to-indigo-500 active:scale-95 text-white rounded-full shadow-[0_10px_30px_rgba(79,70,229,0.3)]"
                  >
                    {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="ml-2" />}
                  </button>
                </div>

                {/* Remover Voz (BETA) */}
                <div className="bg-[#0a0a0c] p-4 rounded-3xl mb-4 border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl transition-colors ${removeVocals ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-400'}`}>
                        <MicOff size={22} />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm">Remover Voz (Beta)</h3>
                        <p className="text-[10px] text-gray-500 mt-0.5">Atenuação central via EQ.</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={removeVocals} onChange={() => setRemoveVocals(!removeVocals)} disabled={isProcessing} />
                      <div className="w-12 h-6 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>
                </div>

                {/* Tom (Modo Vinil) */}
                <div className="bg-[#0a0a0c] p-4 rounded-3xl border border-gray-800 mb-6">
                  <div className="mb-3">
                    <h3 className="font-bold text-sm">Tom (Modo Vinil)</h3>
                    <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                      <AlertCircle size={10} /> Preserva 100% da qualidade.
                    </p>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {[-3, -2, -1, 0, 1, 2, 3].map((val) => (
                      <button
                        key={val} onClick={() => setPitch(val)} disabled={isProcessing}
                        className={`py-3 rounded-xl text-xs font-bold transition-all
                          ${pitch === val ? 'bg-blue-500 text-white shadow-lg' : 'bg-gray-800 text-gray-400'}`}
                      >
                        {val > 0 ? `+${val}` : val === 0 ? 'Orig' : val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Exportar MP3 */}
                {isProcessing ? (
                  <div className="w-full bg-[#0a0a0c] rounded-2xl p-4 flex flex-col items-center border border-blue-500/30 shadow-inner">
                    <div className="flex justify-between w-full text-xs font-extrabold text-blue-400 mb-2">
                      <span className="animate-pulse">A Renderizar MP3...</span>
                      <span>{renderProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className="bg-blue-500 h-full rounded-full transition-all duration-200" style={{ width: `${renderProgress}%` }}></div>
                    </div>
                  </div>
                ) : (
                  <button onClick={processAndSave} className="w-full py-4 bg-white text-gray-950 rounded-2xl text-sm font-extrabold flex justify-center items-center gap-2 shadow-xl active:scale-[0.98]">
                    Exportar MP3 <Download size={18} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ABA 2: ESTÚDIO PRO */}
        {activeTab === 'pro' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {!file ? (
              <div className="text-center py-20 px-6 bg-[#15151a] rounded-[2rem] border border-gray-800/50">
                <Sliders className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-gray-200 font-bold mb-2">Estúdio Pro Bloqueado</h3>
                <p className="text-sm text-gray-500 mb-6">Adicione uma música no "Estúdio Básico" primeiro para desbloquear o Equalizador.</p>
                <button onClick={() => setActiveTab('studio')} className="px-6 py-2.5 bg-blue-500/10 text-blue-400 rounded-full text-sm font-bold">Abrir Básico</button>
              </div>
            ) : (
              <div className="bg-[#15151a] p-5 rounded-[2rem] shadow-xl border border-gray-800/50 relative">
                <div className="flex items-center justify-center gap-2 mb-8">
                  <Sliders className="text-blue-500" size={24}/>
                  <h2 className="text-xl font-bold">Equalizador PRO</h2>
                </div>

                <div className="bg-[#0a0a0c] p-6 rounded-3xl border border-gray-800 mb-6">
                  <div className="mb-8">
                    <div className="flex justify-between mb-2">
                      <span className="font-bold text-sm text-gray-200">Potência de Graves</span>
                      <span className="text-xs text-blue-400 font-bold">{bass > 0 ? '+'+bass : bass} dB</span>
                    </div>
                    <input 
                      type="range" min="-15" max="15" value={bass} 
                      onChange={(e) => setBass(Number(e.target.value))}
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none accent-blue-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="font-bold text-sm text-gray-200">Brilho de Agudos</span>
                      <span className="text-xs text-blue-400 font-bold">{treble > 0 ? '+'+treble : treble} dB</span>
                    </div>
                    <input 
                      type="range" min="-15" max="15" value={treble} 
                      onChange={(e) => setTreble(Number(e.target.value))}
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none accent-blue-500"
                    />
                  </div>
                </div>

                <button onClick={() => { setBass(0); setTreble(0); }} className="w-full py-3 bg-gray-800 text-gray-300 rounded-xl text-sm font-bold">
                  Restaurar Original
                </button>
              </div>
            )}
          </div>
        )}

        {/* ABA 3: BIBLIOTECA E PLAYLISTS */}
        {activeTab === 'library' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            
            {/* Seletor de Playlists */}
            {library.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {playlistsDisponiveis.map(pl => (
                  <button 
                    key={pl} onClick={() => setActivePlaylist(pl)}
                    className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all border ${activePlaylist === pl ? 'bg-blue-500 text-white border-blue-500' : 'bg-[#15151a] text-gray-400 border-gray-800'}`}
                  >
                    {pl}
                  </button>
                ))}
              </div>
            )}

            {bibliotecaFiltrada.length === 0 ? (
              <div className="text-center py-16 px-6 bg-[#15151a] rounded-[2rem] border border-gray-800/50">
                <FolderDown className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-gray-200 font-bold mb-1">Biblioteca Vazia</h3>
                <p className="text-sm text-gray-500">Músicas exportadas em MP3 ficarão salvas aqui para sempre.</p>
              </div>
            ) : (
              bibliotecaFiltrada.map((track) => (
                <div key={track.id} className="bg-[#15151a] p-4 rounded-[1.5rem] border border-gray-800/50 shadow-lg">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0 pr-2">
                      <h3 className="font-bold text-base truncate text-gray-100">{track.name}</h3>
                      <div className="flex gap-2 mt-1.5">
                        <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">{track.details}</span>
                        <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-md border border-purple-500/20 truncate max-w-[100px]">{track.playlist}</span>
                      </div>
                    </div>
                    <button onClick={() => handleDelete(track.id)} className="text-gray-500 hover:text-red-400 p-2">
                      <Trash2 size={18} />
                    </button>
                  </div>
                  
                  <audio controls src={track.url} className="w-full h-11 mb-4 rounded-lg bg-gray-900 
                    [&::-webkit-media-controls-panel]:bg-[#0a0a0c] [&::-webkit-media-controls-current-time-display]:text-blue-400" />
                  
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => handleChangePlaylist(track.id)} className="py-2.5 bg-[#0a0a0c] rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-bold text-gray-300 border border-gray-800">
                      <ListMusic size={14} /> Playlist
                    </button>
                    <button onClick={() => handleRename(track.id, track.name)} className="py-2.5 bg-[#0a0a0c] rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-bold text-gray-300 border border-gray-800">
                      <Edit2 size={14} /> Renomear
                    </button>
                    <button onClick={() => handleShare(track)} className="py-2.5 bg-green-500 text-green-950 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-extrabold shadow-lg shadow-green-500/20 active:scale-95">
                      <Share2 size={14} /> WhatsApp
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Navegação Fixa Inferior */}
      <nav className="fixed bottom-0 w-full max-w-md bg-[#111115]/95 backdrop-blur-xl border-t border-gray-800/80 flex justify-around p-2 pb-safe-area z-30">
        <button onClick={() => setActiveTab('studio')} className={`flex flex-col items-center gap-1.5 p-3 w-24 rounded-2xl transition-all ${activeTab === 'studio' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500'}`}>
          <Settings2 size={22} />
          <span className="text-[10px] font-bold tracking-widest uppercase">Básico</span>
        </button>
        <button onClick={() => setActiveTab('pro')} className={`flex flex-col items-center gap-1.5 p-3 w-24 rounded-2xl transition-all ${activeTab === 'pro' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500'}`}>
          <Sliders size={22} />
          <span className="text-[10px] font-bold tracking-widest uppercase">Estúdio Pro</span>
        </button>
        <button onClick={() => setActiveTab('library')} className={`flex flex-col items-center gap-1.5 p-3 w-24 rounded-2xl transition-all relative ${activeTab === 'library' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500'}`}>
          <FolderDown size={22} />
          <span className="text-[10px] font-bold tracking-widest uppercase">Salvos</span>
          {library.length > 0 && <span className="absolute top-2.5 right-6 w-2 h-2 bg-blue-500 rounded-full border border-[#111115]"></span>}
        </button>
      </nav>
      
    </div>
  );
}