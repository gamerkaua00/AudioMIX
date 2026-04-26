import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Play, Pause, Download, Share2, Edit2, Trash2, 
  MicOff, Settings2, FolderDown, Activity, Check,
  AlertCircle, Sliders, Scissors, Plus, ListMusic, X, User
} from 'lucide-react';

// ==========================================
// 1. BASE DE DADOS LOCAL (IndexedDB)
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
// 2. CODIFICADOR MP3 ASSÍNCRONO
// ==========================================
async function encodeMP3Async(buffer, onProgress) {
  if (!window.lamejs) throw new Error("Aguarde, codificador MP3 a carregar...");
  
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new window.lamejs.Mp3Encoder(channels, sampleRate, 128); 
  const mp3Data = [];

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;
  const sampleBlockSize = 1152; 

  let pos = 0;
  return new Promise((resolve) => {
    function processChunk() {
      const end = Math.min(pos + sampleBlockSize * 10, buffer.length); 
      const leftChunk = new Int16Array(end - pos);
      const rightChunk = new Int16Array(end - pos);

      for (let i = 0; i < end - pos; i++) {
        leftChunk[i] = left[pos + i] * 32767.5;
        rightChunk[i] = right[pos + i] * 32767.5;
      }

      const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) mp3Data.push(mp3buf);

      pos = end;

      if (pos < buffer.length) {
        onProgress(Math.round((pos / buffer.length) * 100));
        setTimeout(processChunk, 10); 
      } else {
        const flushBuf = mp3encoder.flush();
        if (flushBuf.length > 0) mp3Data.push(flushBuf);
        onProgress(100);
        resolve(new Blob(mp3Data, { type: 'audio/mpeg' }));
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
  
  // UI Customizada (Substitui os alerts e prompts bloqueados no Android)
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const [modal, setModal] = useState({ show: false, type: '', track: null, input: '' });

  const showToast = (msg, type = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast({ show: false, msg: '', type: 'success' }), 3500);
  };
  
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [pitch, setPitch] = useState(0); 
  const [removeVocals, setRemoveVocals] = useState(false);
  
  const [bass, setBass] = useState(0);
  const [mid, setMid] = useState(0);
  const [treble, setTreble] = useState(0);
  const [compressor, setCompressor] = useState(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loopA, setLoopA] = useState(null);
  const [loopB, setLoopB] = useState(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);

  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const audioBufferRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  
  const startTimeRef = useRef(0);
  const pausedAtRef = useRef(0);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";
    document.body.appendChild(script);

    getLibraryFromDB().then(tracks => {
      const tracksComUrl = tracks.map(t => ({
        ...t,
        url: URL.createObjectURL(new Blob([t.blob], { type: 'audio/mpeg' }))
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
    
    setPitch(0); setRemoveVocals(false); 
    setBass(0); setMid(0); setTreble(0); setCompressor(false);
    setLoopA(null); setLoopB(null); setCurrentTime(0);
    pausedAtRef.current = 0;

    initAudioContext();
    const arrayBuffer = await uploadedFile.arrayBuffer();
    const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
    audioBufferRef.current = audioBuffer;
    setDuration(audioBuffer.duration);
    showToast("Áudio carregado com sucesso!");
  };

  const applyAudioRouting = (ctx, source, isOffline = false) => {
    const playbackRate = Math.pow(2, pitch / 12);
    source.playbackRate.value = playbackRate;

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 250;
    bassFilter.gain.value = bass;

    const midFilter = ctx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 1.0;
    midFilter.gain.value = mid;

    const trebleFilter = ctx.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 4000;
    trebleFilter.gain.value = treble;

    const dynamicsCompressor = ctx.createDynamicsCompressor();
    if (compressor) {
      dynamicsCompressor.threshold.value = -24;
      dynamicsCompressor.knee.value = 30;
      dynamicsCompressor.ratio.value = 12;
      dynamicsCompressor.attack.value = 0.003;
      dynamicsCompressor.release.value = 0.25;
    } else {
      dynamicsCompressor.threshold.value = 0;
      dynamicsCompressor.ratio.value = 1;
    }

    source.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(dynamicsCompressor);
    let finalOutput = dynamicsCompressor;

    if (removeVocals && audioBufferRef.current.numberOfChannels > 1) {
      const splitter = ctx.createChannelSplitter(2);
      dynamicsCompressor.connect(splitter);

      const center = ctx.createGain(); center.gain.value = 0.5;
      splitter.connect(center, 0); splitter.connect(center, 1);

      const sideL = ctx.createGain(); sideL.gain.value = 0.5;
      const sideR = ctx.createGain(); sideR.gain.value = -0.5;
      splitter.connect(sideL, 0); splitter.connect(sideR, 1);
      const sideSum = ctx.createGain();
      sideL.connect(sideSum); sideR.connect(sideSum);

      const eq1 = ctx.createBiquadFilter(); eq1.type = 'peaking'; eq1.frequency.value = 1200; eq1.Q.value = 0.7; eq1.gain.value = -22;
      center.connect(eq1);
      const eq2 = ctx.createBiquadFilter(); eq2.type = 'peaking'; eq2.frequency.value = 3500; eq2.Q.value = 1.0; eq2.gain.value = -16;
      eq1.connect(eq2);

      const merger = ctx.createChannelMerger(2);
      const outL = ctx.createGain(); eq2.connect(outL); sideSum.connect(outL); outL.connect(merger, 0, 0);
      const outR = ctx.createGain(); eq2.connect(outR); 
      const sideInvert = ctx.createGain(); sideInvert.gain.value = -1; 
      sideSum.connect(sideInvert); sideInvert.connect(outR); outR.connect(merger, 0, 1);

      finalOutput = merger;
    } else if (removeVocals && audioBufferRef.current.numberOfChannels === 1 && !isOffline) {
        // Alerta elegante substituindo window.alert
        showToast("Áudio MONO. O atenuador requer faixas Estéreo.", "error");
        setRemoveVocals(false);
    }

    if (!isOffline) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256; 
      finalOutput.connect(analyser);
      analyserRef.current = analyser;
    }

    return finalOutput;
  };

  const drawVisualizer = () => {
    if (!canvasRef.current || !analyserRef.current || !isPlaying) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, width, height);
    
    const barWidth = (width / bufferLength) * 2;
    let x = 0;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#38bdf8'); 
    gradient.addColorStop(0.5, '#3b82f6'); 
    gradient.addColorStop(1, '#818cf8'); 

    for(let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * (height / 2);
      ctx.fillStyle = gradient;
      ctx.fillRect(x, centerY - barHeight, barWidth, barHeight * 2);
      x += barWidth + 1;
    }
    
    animationRef.current = requestAnimationFrame(drawVisualizer);
  };

  const updateSeekerAndLoop = () => {
    if (!audioContextRef.current || !isPlaying) return;
    
    const ctx = audioContextRef.current;
    const playbackRate = Math.pow(2, pitch / 12);
    let current = ((ctx.currentTime - startTimeRef.current) * playbackRate) + pausedAtRef.current;
    
    if (loopB !== null && current >= loopB) {
      seekTo(loopA || 0);
      return; 
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

    if (sourceNodeRef.current) {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.disconnect();
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBufferRef.current;
    
    const finalNode = applyAudioRouting(ctx, source);
    finalNode.connect(ctx.destination);
    
    source.start(0, pausedAtRef.current);
    startTimeRef.current = ctx.currentTime;
    
    sourceNodeRef.current = source;
    setIsPlaying(true);
    
    if(animationRef.current) cancelAnimationFrame(animationRef.current);
    drawVisualizer();
    requestAnimationFrame(updateSeekerAndLoop);
  };

  const stopPreview = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.onended = null; 
      if (isPlaying) {
        sourceNodeRef.current.stop();
        const ctx = audioContextRef.current;
        const playbackRate = Math.pow(2, pitch / 12);
        pausedAtRef.current = pausedAtRef.current + ((ctx.currentTime - startTimeRef.current) * playbackRate);
      }
      setIsPlaying(false);
    }
    if(animationRef.current) cancelAnimationFrame(animationRef.current);
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
    if (isPlaying && file) {
      stopPreview();
      setTimeout(() => playPreview(), 30);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch, removeVocals, bass, mid, treble, compressor]);

  const processAndSave = async () => {
    if (!audioBufferRef.current) return;
    if (!window.lamejs) { 
        showToast("A carregar motor MP3, aguarde um instante...", "error"); 
        return; 
    }
    
    setIsProcessing(true);
    setRenderProgress(0);
    stopPreview(); 
    setIsPlaying(false); 
    
    if (audioContextRef.current) audioContextRef.current.suspend();

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
      
      const mp3Blob = await encodeMP3Async(renderedBuffer, (percent) => {
        setRenderProgress(Math.max(5, percent)); 
      });

      const url = URL.createObjectURL(mp3Blob);

      const newTrack = {
        id: Date.now().toString(),
        name: `${fileName} (Editado)`,
        url: url,
        blob: mp3Blob,
        playlist: 'Geral',
        details: `Tom: ${pitch === 0 ? 'Orig' : pitch}`
      };

      await saveTrackToDB(newTrack);
      setLibrary([newTrack, ...library]);
      setActiveTab('library');
      
      setFile(null); 
      setPitch(0); setRemoveVocals(false); 
      setBass(0); setMid(0); setTreble(0); setCompressor(false);
      setLoopA(null); setLoopB(null); setCurrentTime(0); pausedAtRef.current = 0;
      
      showToast("Música exportada e guardada com sucesso!");
      if (audioContextRef.current) audioContextRef.current.resume();

    } catch (error) {
      console.error(error);
      showToast("Houve um erro na renderização.", "error");
    } finally {
      setIsProcessing(false);
      setRenderProgress(0);
    }
  };

  // --- SOLUÇÃO DE EXPORTAÇÃO E PARTILHA NATIVA UNIFICADA ---
  const handleExport = async (track) => {
    try {
      const file = new File([track.blob], `${track.name}.mp3`, { type: 'audio/mpeg' });
      
      // No Android WebView, o navigator.share abre a aba de partilha real,
      // permitindo ao utilizador "Guardar no dispositivo" ou enviar para WhatsApp.
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ 
          title: track.name, 
          text: 'Música editada no AudioMIX',
          files: [file] 
        });
        showToast("Ação concluída com sucesso!");
      } else {
        // Fallback seguro para desktop / navegadores que não suportem Share
        const blobUrl = URL.createObjectURL(track.blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = `${track.name}.mp3`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        }, 1000);
        showToast("Transferência iniciada!");
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error("Erro na partilha:", err);
        showToast("Erro ao exportar o ficheiro.", "error");
      }
    }
  };

  // --- FUNÇÕES DA BIBLIOTECA USANDO MODAIS NATIVAS (SEM ALERTS/PROMPTS) ---
  const executeRename = async () => {
      if(modal.input.trim() !== "") {
          const track = library.find(t => t.id === modal.track.id);
          track.name = modal.input.trim();
          await saveTrackToDB(track);
          setLibrary([...library]);
          showToast("Nome atualizado com sucesso!");
      }
      setModal({ show: false, type: '', track: null, input: '' });
  };

  const executePlaylist = async () => {
      if(modal.input.trim() !== "") {
          const track = library.find(t => t.id === modal.track.id);
          track.playlist = modal.input.trim();
          await saveTrackToDB(track);
          setLibrary([...library]);
          showToast(`Movida para a playlist "${modal.input.trim()}"!`);
      }
      setModal({ show: false, type: '', track: null, input: '' });
  };

  const executeDelete = async () => {
      await deleteTrackFromDB(modal.track.id);
      setLibrary(library.filter(t => t.id !== modal.track.id));
      showToast("Música eliminada permanentemente.");
      setModal({ show: false, type: '', track: null, input: '' });
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
    <div className="min-h-screen bg-[#070709] text-gray-100 font-sans flex flex-col items-center select-none">
      
      {/* TOAST NOTIFICATION (Substitui os alertas do sistema) */}
      {toast.show && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-top-5 fade-in duration-300">
            <div className={`shadow-2xl rounded-full px-5 py-3 flex items-center gap-3 border ${toast.type === 'error' ? 'bg-red-950/95 border-red-500/50' : 'bg-blue-950/95 border-blue-500/50'}`}>
                <Activity size={16} className={toast.type === 'error' ? 'text-red-400' : 'text-blue-400'} />
                <span className="text-xs font-bold text-white whitespace-nowrap">{toast.msg}</span>
            </div>
        </div>
      )}

      {/* CUSTOM MODAL (Substitui prompts e confirms bloqueados pelo WebView) */}
      {modal.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm px-5 animate-in fade-in duration-200">
           <div className="bg-[#0f0f13] border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-2">
                  {modal.type === 'delete' ? 'Eliminar Música' : modal.type === 'rename' ? 'Renomear Música' : 'Mover para Playlist'}
              </h3>
              {modal.type === 'delete' ? (
                  <p className="text-gray-400 text-sm mb-6">Tem a certeza que deseja apagar "{modal.track?.name}" permanentemente?</p>
              ) : (
                  <input 
                      type="text" 
                      value={modal.input} 
                      onChange={(e) => setModal({...modal, input: e.target.value})}
                      className="w-full bg-[#070709] border border-white/10 rounded-xl px-4 py-3 text-white mb-6 outline-none focus:border-blue-500 transition-colors"
                      placeholder={modal.type === 'rename' ? "Novo nome da música..." : "Nome da playlist (ex: Ensaios)"}
                      autoFocus
                  />
              )}
              <div className="flex gap-3">
                  <button onClick={() => setModal({ show: false, type: '', track: null, input: '' })} className="flex-1 py-3 rounded-xl bg-[#1a1a24] text-gray-300 font-bold active:scale-95 transition-all">Cancelar</button>
                  <button onClick={modal.type === 'delete' ? executeDelete : modal.type === 'rename' ? executeRename : executePlaylist} className={`flex-1 py-3 rounded-xl font-bold active:scale-95 transition-all ${modal.type === 'delete' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>
                      Confirmar
                  </button>
              </div>
           </div>
        </div>
      )}

      {/* CABEÇALHO */}
      <header className="w-full max-w-md p-6 pt-safe-area flex justify-center items-center bg-[#0a0a0c]/80 backdrop-blur-xl sticky top-0 z-20">
        <h1 className="text-xl font-black tracking-wide text-white flex items-center gap-2">
          <Activity className="text-blue-500" size={22} /> AudioMIX
        </h1>
      </header>

      <main className="flex-1 w-full max-w-md px-5 pt-2 pb-28 overflow-y-auto">
        
        {/* ABA 1: BÁSICO */}
        {activeTab === 'studio' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {!file ? (
              <label className="flex flex-col items-center justify-center w-full h-[22rem] rounded-[2rem] cursor-pointer bg-[#0f0f13] hover:bg-[#131318] transition-colors border border-white/5 shadow-xl">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center mb-6 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
                    <Upload size={32} />
                  </div>
                  <h2 className="mb-2 text-lg text-white font-bold tracking-tight">Adicionar Áudio</h2>
                  <p className="text-xs text-gray-500">Selecione uma música do dispositivo</p>
                </div>
                <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} disabled={isProcessing} />
              </label>
            ) : (
              <div className="bg-[#0f0f13] p-6 rounded-[2rem] shadow-xl border border-white/5">
                
                <div className="w-full h-24 bg-[#070709] rounded-2xl mb-6 flex items-center justify-center overflow-hidden border border-white/5 relative">
                  <canvas ref={canvasRef} width="300" height="80" className="w-full h-full opacity-90" />
                </div>

                <div className="text-center mb-6">
                  <h2 className="text-sm font-bold text-gray-100 truncate px-4">{fileName}</h2>
                </div>

                <div className="mb-8">
                  <div className="flex justify-between text-[10px] text-gray-400 font-bold mb-3">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <input 
                    type="range" min="0" max={duration || 100} value={currentTime} 
                    onChange={(e) => seekTo(e.target.value)}
                    className="w-full h-2 bg-[#1a1a24] rounded-lg appearance-none cursor-pointer accent-blue-500 mb-4"
                  />
                  
                  <div className="flex items-center justify-between bg-[#070709] p-2 rounded-xl border border-white/5">
                    <div className="flex gap-2">
                      <button onClick={() => setLoopA(currentTime)} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all active:scale-95 ${loopA !== null ? 'bg-blue-500 text-white shadow-lg' : 'bg-[#15151e] text-gray-400'}`}>
                        {loopA !== null ? `A: ${formatTime(loopA)}` : 'Início'}
                      </button>
                      <button onClick={() => setLoopB(currentTime)} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all active:scale-95 ${loopB !== null ? 'bg-blue-500 text-white shadow-lg' : 'bg-[#15151e] text-gray-400'}`}>
                        {loopB !== null ? `B: ${formatTime(loopB)}` : 'Fim'}
                      </button>
                    </div>
                    {(loopA !== null || loopB !== null) && (
                      <button onClick={() => {setLoopA(null); setLoopB(null);}} className="text-gray-500 hover:text-red-400 p-2 rounded-lg transition-colors">
                        <X size={18} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex justify-center mb-8 relative">
                  <div className="absolute inset-0 bg-blue-500/10 blur-2xl rounded-full scale-125"></div>
                  <button 
                    onClick={togglePlay} disabled={isProcessing}
                    className="relative w-20 h-20 flex items-center justify-center bg-blue-600 hover:bg-blue-500 active:scale-90 text-white rounded-full shadow-[0_10px_30px_rgba(59,130,246,0.3)] transition-all"
                  >
                    {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
                  </button>
                </div>

                <div className="bg-[#070709] p-4 rounded-2xl mb-4 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <MicOff size={20} className={removeVocals ? 'text-blue-400' : 'text-gray-600'} />
                      <h3 className="font-semibold text-sm text-gray-200">Atenuador de Voz</h3>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={removeVocals} onChange={() => setRemoveVocals(!removeVocals)} disabled={isProcessing} />
                      <div className="w-11 h-6 bg-[#1a1a24] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>
                </div>

                <div className="bg-[#070709] p-4 rounded-2xl border border-white/5 mb-6">
                  <h3 className="font-semibold text-sm text-gray-200 mb-3">Ajuste de Tom</h3>
                  <div className="grid grid-cols-7 gap-1">
                    {[-3, -2, -1, 0, 1, 2, 3].map((val) => (
                      <button
                        key={val} onClick={() => setPitch(val)} disabled={isProcessing}
                        className={`py-2.5 rounded-lg text-xs font-bold transition-all active:scale-90
                          ${pitch === val ? 'bg-blue-500 text-white shadow-md' : 'bg-[#15151e] text-gray-400'}`}
                      >
                        {val > 0 ? `+${val}` : val === 0 ? '0' : val}
                      </button>
                    ))}
                  </div>
                </div>

                {isProcessing ? (
                  <div className="w-full bg-[#070709] rounded-2xl p-4 flex flex-col items-center border border-white/5">
                    <div className="flex justify-between w-full text-xs font-bold text-blue-400 mb-2">
                      <span className="animate-pulse">A Renderizar...</span>
                      <span>{renderProgress}%</span>
                    </div>
                    <div className="w-full bg-[#1a1a24] rounded-full h-1.5">
                      <div className="bg-blue-500 h-full rounded-full transition-all duration-300" style={{ width: `${renderProgress}%` }}></div>
                    </div>
                  </div>
                ) : (
                  <button onClick={processAndSave} className="w-full py-4 bg-white text-black rounded-2xl text-sm font-bold flex justify-center items-center gap-2 active:scale-95 transition-transform">
                    Gravar e Guardar <Download size={18} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ABA 2: PRO */}
        {activeTab === 'pro' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {!file ? (
              <div className="text-center py-24 px-6 bg-[#0f0f13] rounded-[2rem] border border-white/5">
                <Sliders className="w-10 h-10 text-gray-700 mx-auto mb-4" />
                <h3 className="text-white font-bold mb-2">Mesa de Mistura</h3>
                <p className="text-xs text-gray-500 mb-6">Carregue um ficheiro no menu Básico.</p>
              </div>
            ) : (
              <div className="bg-[#0f0f13] p-6 rounded-[2rem] shadow-xl border border-white/5">
                <h2 className="text-lg font-bold mb-8 text-white">Equalizador</h2>

                <div className="space-y-8 mb-10">
                  <div>
                    <div className="flex justify-between mb-3">
                      <span className="font-semibold text-sm text-gray-300">Graves</span>
                      <span className="text-xs text-blue-400 font-bold">{bass} dB</span>
                    </div>
                    <input type="range" min="-15" max="15" value={bass} onChange={(e) => setBass(Number(e.target.value))} className="w-full h-1.5 bg-[#1a1a24] rounded-lg appearance-none accent-blue-500"/>
                  </div>
                  
                  <div>
                    <div className="flex justify-between mb-3">
                      <span className="font-semibold text-sm text-gray-300">Médios</span>
                      <span className="text-xs text-blue-400 font-bold">{mid} dB</span>
                    </div>
                    <input type="range" min="-15" max="15" value={mid} onChange={(e) => setMid(Number(e.target.value))} className="w-full h-1.5 bg-[#1a1a24] rounded-lg appearance-none accent-blue-500"/>
                  </div>

                  <div>
                    <div className="flex justify-between mb-3">
                      <span className="font-semibold text-sm text-gray-300">Agudos</span>
                      <span className="text-xs text-blue-400 font-bold">{treble} dB</span>
                    </div>
                    <input type="range" min="-15" max="15" value={treble} onChange={(e) => setTreble(Number(e.target.value))} className="w-full h-1.5 bg-[#1a1a24] rounded-lg appearance-none accent-blue-500"/>
                  </div>
                </div>

                <div className="bg-[#070709] p-4 rounded-2xl border border-white/5 mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm text-gray-200">Compressor / Mastering</h3>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={compressor} onChange={() => setCompressor(!compressor)} />
                      <div className="w-11 h-6 bg-[#1a1a24] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>
                </div>

                <button onClick={() => { setBass(0); setMid(0); setTreble(0); setCompressor(false); }} className="w-full py-3.5 bg-[#1a1a24] active:scale-95 text-gray-300 rounded-2xl text-sm font-bold transition-all">
                  Repor Padrão
                </button>
              </div>
            )}
          </div>
        )}

        {/* ABA 3: SALVOS */}
        {activeTab === 'library' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {library.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {playlistsDisponiveis.map(pl => (
                  <button 
                    key={pl} onClick={() => setActivePlaylist(pl)}
                    className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all active:scale-95 ${activePlaylist === pl ? 'bg-blue-500 text-white' : 'bg-[#0f0f13] text-gray-400 border border-white/5'}`}
                  >
                    {pl}
                  </button>
                ))}
              </div>
            )}

            {bibliotecaFiltrada.length === 0 ? (
              <div className="text-center py-24 px-6 bg-[#0f0f13] rounded-[2rem] border border-white/5">
                <FolderDown className="w-10 h-10 text-gray-700 mx-auto mb-4" />
                <h3 className="text-gray-200 font-bold mb-1">Sem Gravações</h3>
                <p className="text-xs text-gray-500">O que exportar irá aparecer aqui.</p>
              </div>
            ) : (
              bibliotecaFiltrada.map((track) => (
                <div key={track.id} className="bg-[#0f0f13] p-5 rounded-[1.5rem] border border-white/5 shadow-lg">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1 min-w-0 pr-2">
                      <h3 className="font-bold text-sm text-gray-100 truncate">{track.name}</h3>
                      <div className="flex gap-2 mt-1.5">
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{track.details}</span>
                      </div>
                    </div>
                    <button onClick={() => setModal({ show: true, type: 'delete', track: track, input: '' })} className="text-gray-600 hover:text-red-400 transition-colors">
                      <Trash2 size={18} />
                    </button>
                  </div>
                  
                  <audio controls src={track.url} className="w-full h-10 mb-4 rounded-lg bg-[#070709]" />
                  
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => setModal({ show: true, type: 'playlist', track: track, input: track.playlist || '' })} className="py-3 bg-[#1a1a24] active:scale-95 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-300 transition-all">
                      <ListMusic size={14} /> Mover
                    </button>
                    <button onClick={() => setModal({ show: true, type: 'rename', track: track, input: track.name })} className="py-3 bg-[#1a1a24] active:scale-95 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-300 transition-all">
                      <Edit2 size={14} /> Renomear
                    </button>
                    <button onClick={() => handleExport(track)} className="py-3 bg-blue-600 active:bg-blue-500 text-white active:scale-95 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold transition-all shadow-[0_4px_15px_rgba(37,99,235,0.3)]">
                      <Share2 size={14} /> Partilhar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ABA 4: CRÉDITOS */}
        {activeTab === 'credits' && (
          <div className="space-y-6 animate-in fade-in duration-300 flex flex-col items-center justify-center h-full pt-10">
            <div className="text-center w-full max-w-sm">
                <div className="w-24 h-24 bg-[#0f0f13] border border-white/5 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl">
                    <Activity size={40} className="text-blue-500" />
                </div>
                <h2 className="text-2xl font-black text-white mb-1 tracking-wide">AudioMIX</h2>
                <p className="text-gray-500 text-xs uppercase tracking-widest mb-10">Versão 1.0</p>
                
                <div className="bg-[#0f0f13] p-6 rounded-3xl border border-white/5 text-left shadow-lg">
                    <p className="text-gray-600 text-[10px] uppercase tracking-widest font-bold mb-1">Criador</p>
                    <p className="text-gray-200 font-bold text-sm mb-6">Kauã Mazur dos Reis</p>

                    <p className="text-gray-600 text-[10px] uppercase tracking-widest font-bold mb-1">Contacto</p>
                    <a href="mailto:kmzsuportt1@gmail.com" className="text-blue-400 font-bold text-sm">kmzsuportt1@gmail.com</a>
                </div>
            </div>
          </div>
        )}
      </main>

      {/* Navegação Inferior */}
      <nav className="fixed bottom-0 w-full max-w-md bg-[#070709]/95 backdrop-blur-xl border-t border-white/5 flex justify-between px-3 py-2 pb-safe-area z-30">
        <button onClick={() => setActiveTab('studio')} className={`flex flex-col items-center justify-center gap-1 p-2 w-1/4 rounded-xl transition-all active:scale-90 ${activeTab === 'studio' ? 'text-white' : 'text-gray-600'}`}>
          <Settings2 size={20} className={activeTab === 'studio' ? 'text-blue-500' : ''} />
          <span className="text-[10px] font-semibold">Básico</span>
        </button>
        <button onClick={() => setActiveTab('pro')} className={`flex flex-col items-center justify-center gap-1 p-2 w-1/4 rounded-xl transition-all active:scale-90 ${activeTab === 'pro' ? 'text-white' : 'text-gray-600'}`}>
          <Sliders size={20} className={activeTab === 'pro' ? 'text-blue-500' : ''} />
          <span className="text-[10px] font-semibold">Mixer</span>
        </button>
        <button onClick={() => setActiveTab('library')} className={`flex flex-col items-center justify-center gap-1 p-2 w-1/4 rounded-xl transition-all active:scale-90 relative ${activeTab === 'library' ? 'text-white' : 'text-gray-600'}`}>
          <FolderDown size={20} className={activeTab === 'library' ? 'text-blue-500' : ''} />
          <span className="text-[10px] font-semibold">Salvos</span>
          {library.length > 0 && <span className="absolute top-2 right-6 w-2 h-2 bg-blue-500 rounded-full"></span>}
        </button>
        <button onClick={() => setActiveTab('credits')} className={`flex flex-col items-center justify-center gap-1 p-2 w-1/4 rounded-xl transition-all active:scale-90 ${activeTab === 'credits' ? 'text-white' : 'text-gray-600'}`}>
          <User size={20} className={activeTab === 'credits' ? 'text-blue-500' : ''} />
          <span className="text-[10px] font-semibold">Créditos</span>
        </button>
      </nav>
      
    </div>
  );
}