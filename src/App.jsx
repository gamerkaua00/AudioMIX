import React, { useState, useRef, useEffect } from 'react';
import { 
    Upload, Play, Pause, Download, Share2, Edit2, Trash2, 
    Settings2, FolderDown, Activity, Check, AlertCircle, 
    Info, FlaskConical, User 
} from 'lucide-react';

// ==========================================
// 1. CORE: EXPORTADOR DE ÁUDIO (.WAV ENCODER)
// ==========================================
function audioBufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numOfChan * 2;
    const bufferArray = new ArrayBuffer(44 + length);
    const view = new DataView(bufferArray);
    const channels = [];
    let sample, offset = 0, pos = 0;

    // RIFF Header
    setUint32(0x46464952); setUint32(36 + length); setUint32(0x45564157);
    setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan); setUint16(numOfChan * 2);
    setUint16(16); setUint32(0x61746164); setUint32(length);

    for (let i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    // Escreve os dados PCM
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

// ==========================================
// 2. APLICAÇÃO PRINCIPAL (REACT APP)
// ==========================================
export default function App() {
    const [activeTab, setActiveTab] = useState('studio');
    const [library, setLibrary] = useState([]);
    
    const [file, setFile] = useState(null);
    const [fileName, setFileName] = useState("");
    const [isPlaying, setIsPlaying] = useState(false);
    const [pitch, setPitch] = useState(0); 
    const [removeVocals, setRemoveVocals] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    const audioContextRef = useRef(null);
    const sourceNodeRef = useRef(null);
    const audioBufferRef = useRef(null);
    const startTimeRef = useRef(0);
    const pausedAtRef = useRef(0);

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
        setPitch(0);
        setRemoveVocals(false);
        pausedAtRef.current = 0;

        initAudioContext();
        const arrayBuffer = await uploadedFile.arrayBuffer();
        const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
        audioBufferRef.current = audioBuffer;
    };

    // --- MOTOR DSP (Digital Signal Processing) ---
    const applyAudioRouting = (ctx, source) => {
        source.playbackRate.value = Math.pow(2, pitch / 12);

        if (!removeVocals) return source;

        if (audioBufferRef.current.numberOfChannels === 1) {
            alert("Aviso: O áudio é MONO. O filtro atenuador requer ficheiros Estéreo para funcionar.");
            setRemoveVocals(false);
            return source;
        }

        const splitter = ctx.createChannelSplitter(2);
        source.connect(splitter);

        const mid = ctx.createGain(); mid.gain.value = 0.5;
        splitter.connect(mid, 0); splitter.connect(mid, 1);

        const sideL = ctx.createGain(); sideL.gain.value = 0.5;
        const sideR = ctx.createGain(); sideR.gain.value = -0.5;
        splitter.connect(sideL, 0); splitter.connect(sideR, 1);
        const sideSum = ctx.createGain();
        sideL.connect(sideSum); sideR.connect(sideSum);

        const eq1 = ctx.createBiquadFilter();
        eq1.type = 'peaking'; eq1.frequency.value = 1200; eq1.Q.value = 0.7; eq1.gain.value = -22;
        mid.connect(eq1);

        const eq2 = ctx.createBiquadFilter();
        eq2.type = 'peaking'; eq2.frequency.value = 3500; eq2.Q.value = 1.0; eq2.gain.value = -16;
        eq1.connect(eq2);

        const eq3 = ctx.createBiquadFilter();
        eq3.type = 'peaking'; eq3.frequency.value = 300; eq3.Q.value = 1.2; eq3.gain.value = -10;
        eq2.connect(eq3);

        const merger = ctx.createChannelMerger(2);
        const outL = ctx.createGain(); eq3.connect(outL); sideSum.connect(outL); outL.connect(merger, 0, 0);
        const outR = ctx.createGain(); eq3.connect(outR); 
        const sideInvert = ctx.createGain(); sideInvert.gain.value = -1; 
        sideSum.connect(sideInvert); sideInvert.connect(outR); outR.connect(merger, 0, 1);

        return merger;
    };

    // --- CONTROLES DE REPRODUÇÃO ---
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
        startTimeRef.current = ctx.currentTime - pausedAtRef.current;
        sourceNodeRef.current = source;
        setIsPlaying(true);

        source.onended = () => {
            if (sourceNodeRef.current === source) {
                setIsPlaying(false);
                pausedAtRef.current = 0;
            }
        };
    };

    const stopPreview = () => {
        if (sourceNodeRef.current && isPlaying) {
            sourceNodeRef.current.stop();
            pausedAtRef.current = audioContextRef.current.currentTime - startTimeRef.current;
            setIsPlaying(false);
        }
    };

    const togglePlay = () => {
        if (isPlaying) stopPreview();
        else playPreview();
    };

    useEffect(() => {
        if (isPlaying) {
            stopPreview();
            setTimeout(() => playPreview(), 30);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pitch, removeVocals]);

    // --- RENDERIZAÇÃO OFFLINE ---
    const processAndSave = async () => {
        if (!audioBufferRef.current) return;
        setIsProcessing(true);
        stopPreview();

        try {
            const originalBuffer = audioBufferRef.current;
            const playbackRate = Math.pow(2, pitch / 12);
            const newDuration = originalBuffer.duration / playbackRate;
            
            const offlineCtx = new window.OfflineAudioContext(
                2, 
                newDuration * originalBuffer.sampleRate, 
                originalBuffer.sampleRate
            );

            const source = offlineCtx.createBufferSource();
            source.buffer = originalBuffer;

            const finalNode = applyAudioRouting(offlineCtx, source);
            finalNode.connect(offlineCtx.destination);
            source.start(0);

            const renderedBuffer = await offlineCtx.startRendering();
            const wavBlob = audioBufferToWav(renderedBuffer);
            const url = URL.createObjectURL(wavBlob);

            const newTrack = {
                id: Date.now().toString(),
                name: `${fileName}`,
                url: url,
                blob: wavBlob,
                details: `Tom: ${pitch === 0 ? 'Orig' : pitch > 0 ? '+'+pitch : pitch} | Playback: ${removeVocals ? 'Atenuado' : 'Não'}`
            };

            setLibrary([newTrack, ...library]);
            setActiveTab('library');
            
            setFile(null);
            setPitch(0);
            setRemoveVocals(false);
            pausedAtRef.current = 0;
        } catch (error) {
            console.error("Erro no processamento:", error);
            alert("Houve um erro ao renderizar o áudio.");
        } finally {
            setIsProcessing(false);
        }
    };

    // --- AÇÕES DA BIBLIOTECA ---
    const handleShare = async (track) => {
        const fileToShare = new File([track.blob], `${track.name}.wav`, { type: 'audio/wav' });
        if (navigator.canShare && navigator.canShare({ files: [fileToShare] })) {
            try {
                await navigator.share({
                    title: track.name,
                    text: 'Confira este playback!',
                    files: [fileToShare]
                });
            } catch (err) {
                console.log("Compartilhamento cancelado", err);
            }
        } else {
            alert("Dispositivo não suporta partilha nativa. Use o botão de Transferir.");
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
        const newName = prompt("Mudar o nome do ficheiro:", oldName);
        if (newName && newName.trim() !== "") {
            setLibrary(library.map(t => t.id === id ? { ...t, name: newName.trim() } : t));
        }
    };

    const handleDelete = (id) => {
        if(confirm("Remover esta música da biblioteca?")) {
            setLibrary(library.filter(t => t.id !== id));
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center pb-8 font-sans selection:bg-blue-500/30">
            {/* HEADER */}
            <header className="w-full max-w-md p-5 pt-safe-area flex justify-between items-center bg-[#111115]/95 backdrop-blur-md border-b border-gray-800 shadow-lg sticky top-0 z-30">
                <div>
                    <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent flex items-center gap-2">
                        <Activity size={20} className="text-blue-500" /> Estúdio Playback
                    </h1>
                    <p className="text-[10px] text-gray-400 font-semibold tracking-widest uppercase mt-0.5">App Edition • v1.0</p>
                </div>
            </header>

            {/* MAIN CONTENT */}
            <main className="flex-1 w-full max-w-md p-5 overflow-y-auto pb-28">
                {/* TAB: ESTÚDIO */}
                {activeTab === 'studio' && (
                    <div className="space-y-5 animate-in fade-in duration-300">
                        {!file ? (
                            <label className="flex flex-col items-center justify-center w-full h-80 border-2 border-gray-800 border-dashed rounded-[2rem] cursor-pointer bg-gradient-to-b from-[#15151a] to-[#111115] hover:border-blue-500/50 transition-all group shadow-inner">
                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                    <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                                        <Upload className="text-blue-400 drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]" size={32} />
                                    </div>
                                    <h2 className="mb-2 text-lg text-gray-100 font-extrabold tracking-tight">Importar Música</h2>
                                    <p className="text-sm text-gray-500 text-center px-8">Selecione um MP3 do seu aparelho para iniciar a edição.</p>
                                </div>
                                <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
                            </label>
                        ) : (
                            <div className="bg-[#15151a] p-6 rounded-[2rem] shadow-2xl border border-gray-800/60 relative">
                                <div className="text-center mb-8">
                                    <h2 className="text-lg font-bold text-gray-100 truncate px-2">{fileName}</h2>
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 mt-2 bg-green-500/10 text-green-400 rounded-full text-[10px] font-bold uppercase tracking-wider border border-green-500/20">
                                        <Check size={12}/> Áudio Carregado
                                    </span>
                                </div>

                                <div className="flex justify-center mb-8 relative">
                                    <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full scale-150"></div>
                                    <button 
                                        onClick={togglePlay}
                                        className="relative w-24 h-24 flex items-center justify-center bg-gradient-to-tr from-blue-600 to-indigo-500 hover:scale-105 active:scale-95 text-white rounded-full shadow-[0_10px_40px_rgba(79,70,229,0.4)] transition-all"
                                    >
                                        {isPlaying ? <Pause size={32} /> : <Play size={32} className="ml-2" />}
                                    </button>
                                </div>

                                {/* Pitch Shifter */}
                                <div className="bg-[#0a0a0c] p-5 rounded-3xl mb-4 border border-gray-800/80 shadow-inner relative overflow-hidden">
                                    <div className="mb-4 flex justify-between items-start">
                                        <div>
                                            <h3 className="font-bold text-sm text-gray-200">Tom & Tempo (Modo Vinil)</h3>
                                            <p className="text-[10px] text-gray-500 mt-0.5 leading-tight pr-4">Resampling Analógico. O tom afeta levemente a velocidade do áudio.</p>
                                        </div>
                                        <div className="text-blue-500 bg-blue-500/10 px-2 py-1 rounded-lg text-xs font-bold border border-blue-500/20">
                                            {pitch > 0 ? `+${pitch}` : pitch} semi
                                        </div>
                                    </div>
                                    
                                    <div className="grid grid-cols-7 gap-1.5">
                                        {[-3, -2, -1, 0, 1, 2, 3].map((val) => (
                                            <button
                                                key={val}
                                                onClick={() => setPitch(val)}
                                                className={`py-3 flex flex-col items-center justify-center rounded-xl text-xs font-bold transition-all
                                                    ${pitch === val 
                                                        ? 'bg-blue-500 text-white shadow-[0_4px_15px_rgba(59,130,246,0.4)] scale-110 z-10' 
                                                        : 'bg-[#15151a] text-gray-400 hover:bg-gray-800 border border-gray-800'
                                                    }`}
                                            >
                                                {val > 0 ? `+${val}` : val === 0 ? '0' : val}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Filtro de Voz */}
                                <div className="bg-[#0a0a0c] p-5 rounded-3xl border border-orange-900/30 shadow-inner relative overflow-hidden">
                                    <div className="absolute top-0 right-0 bg-orange-500 text-orange-950 text-[9px] font-extrabold px-3 py-1 rounded-bl-xl uppercase tracking-wider">
                                        Testes Iniciais
                                    </div>

                                    <div className="flex items-center justify-between mb-3 mt-1">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-3 rounded-2xl transition-colors ${removeVocals ? 'bg-orange-500/20 text-orange-400' : 'bg-[#15151a] text-gray-500 border border-gray-800'}`}>
                                                <FlaskConical size={22} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-sm text-gray-200">Atenuador de Voz</h3>
                                                <p className="text-[11px] text-orange-400/80 font-medium mt-0.5">Mid/Side EQ Web</p>
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" className="sr-only peer" checked={removeVocals} onChange={() => setRemoveVocals(!removeVocals)} />
                                            <div className="w-14 h-7 bg-gray-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-orange-500 shadow-inner"></div>
                                        </label>
                                    </div>
                                </div>

                                <div className="mt-8 flex flex-col gap-3">
                                    <button 
                                        onClick={processAndSave}
                                        disabled={isProcessing}
                                        className="w-full py-4 bg-gray-100 hover:bg-white text-gray-950 rounded-2xl text-sm font-extrabold transition-all flex justify-center items-center gap-2 shadow-[0_5px_20px_rgba(255,255,255,0.1)] disabled:opacity-50 active:scale-[0.98]"
                                    >
                                        {isProcessing ? 'A Processar Áudio HD...' : <span className="flex items-center gap-2">Guardar na Biblioteca <Download size={18}/></span>}
                                    </button>
                                    <button 
                                        onClick={() => { setFile(null); stopPreview(); }}
                                        className="w-full py-3 bg-transparent text-gray-500 hover:text-gray-300 rounded-2xl text-sm font-semibold transition-colors"
                                    >
                                        Trocar Ficheiro
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB: BIBLIOTECA */}
                {activeTab === 'library' && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        {library.length === 0 ? (
                            <div className="text-center py-20 px-6 bg-[#15151a] rounded-[2rem] border border-gray-800/50 shadow-inner">
                                <div className="w-20 h-20 bg-gray-800/30 rounded-full flex items-center justify-center mx-auto mb-5">
                                    <FolderDown className="text-gray-600" size={36} />
                                </div>
                                <h3 className="text-gray-200 font-bold mb-2 text-lg">Biblioteca Vazia</h3>
                                <p className="text-sm text-gray-500 mb-6">Os seus playbacks exportados aparecerão aqui.</p>
                                <button onClick={() => setActiveTab('studio')} className="px-8 py-3 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-sm font-bold active:scale-95 transition-transform">
                                    Abrir Estúdio
                                </button>
                            </div>
                        ) : (
                            library.map((track) => (
                                <div key={track.id} className="bg-[#15151a] p-5 rounded-[1.5rem] border border-gray-800/60 shadow-lg">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex-1 min-w-0 pr-4">
                                            <h3 className="font-bold text-base truncate text-gray-100">{track.name}</h3>
                                            <div className="flex gap-2 mt-1.5">
                                                <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/10">{track.details.split('|')[0]}</span>
                                                <span className="text-[10px] font-bold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-md border border-orange-500/10">{track.details.split('|')[1]}</span>
                                            </div>
                                        </div>
                                        <button onClick={() => handleDelete(track.id)} className="text-gray-600 hover:text-red-400 bg-[#0a0a0c] p-2.5 rounded-xl border border-gray-800 transition-colors">
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                    
                                    <audio controls src={track.url} className="w-full h-12 mb-5 rounded-xl bg-[#0a0a0c] outline-none shadow-inner" />
                                    
                                    <div className="flex gap-2.5">
                                        <button onClick={() => handleDownload(track)} className="flex-1 py-3 bg-[#0a0a0c] rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-gray-300 border border-gray-800 active:bg-gray-800">
                                            <Download size={16} /> Transferir
                                        </button>
                                        <button onClick={() => handleRename(track.id, track.name)} className="flex-1 py-3 bg-[#0a0a0c] rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-gray-300 border border-gray-800 active:bg-gray-800">
                                            <Edit2 size={16} /> Editar
                                        </button>
                                        <button onClick={() => handleShare(track)} className="flex-[1.2] py-3 bg-green-500 text-green-950 rounded-xl flex items-center justify-center gap-2 text-xs font-extrabold shadow-[0_4px_15px_rgba(34,197,94,0.3)] active:scale-95 transition-transform">
                                            <Share2 size={16} /> Partilhar
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* TAB: CRÉDITOS */}
                {activeTab === 'credits' && (
                    <div className="space-y-6 animate-in fade-in duration-300 flex flex-col items-center justify-center h-full pt-6">
                        <div className="bg-[#15151a] p-8 rounded-[2rem] border border-gray-800/60 shadow-2xl text-center w-full max-w-sm relative overflow-hidden mt-4">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
                            <div className="w-20 h-20 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_10px_30px_rgba(79,70,229,0.4)]">
                                <Activity size={32} className="text-white" />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-100 mb-1">Estúdio Playback</h2>
                            <p className="text-blue-400 text-xs font-semibold tracking-widest uppercase mb-6">Motor HD v1.0</p>
                            
                            <div className="bg-[#0a0a0c] p-5 rounded-2xl border border-gray-800 mb-6 text-left shadow-inner">
                                <p className="text-gray-500 text-[10px] uppercase tracking-widest mb-1 font-bold">Desenvolvedor & Criador</p>
                                <p className="text-gray-200 font-extrabold text-base">Kauã Mazur dos Reis</p>
                                
                                <div className="w-full h-px bg-gray-800 my-4"></div>

                                <p className="text-gray-500 text-[10px] uppercase tracking-widest mb-1 font-bold">Contacto / Suporte</p>
                                <a href="mailto:kmzsuportt1@gmail.com" className="text-blue-400 font-bold text-sm hover:text-blue-300 transition-colors">kmzsuportt1@gmail.com</a>
                            </div>

                            <div className="text-gray-500 text-[10px] font-medium tracking-wide">
                                <p>&copy; 2026 Kauã Mazur. Todos os direitos reservados.</p>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* BOTTOM NAVIGATION */}
            <nav className="fixed bottom-0 w-full max-w-md bg-[#111115]/80 backdrop-blur-xl border-t border-gray-800/50 flex justify-around p-2 pb-safe-area z-30 shadow-[0_-10px_40px_rgba(0,0,0,0.3)]">
                <button onClick={() => setActiveTab('studio')} className={`flex flex-col items-center gap-1.5 p-3 w-24 rounded-2xl transition-all ${activeTab === 'studio' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500'}`}>
                    <Settings2 size={24} />
                    <span className="text-[10px] font-bold tracking-widest uppercase mt-0.5">Estúdio</span>
                </button>
                <button onClick={() => setActiveTab('library')} className={`flex flex-col items-center gap-1.5 p-3 w-24 rounded-2xl relative transition-all ${activeTab === 'library' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500'}`}>
                    <FolderDown size={24} />
                    <span className="text-[10px] font-bold tracking-widest uppercase mt-0.5">Ficheiros</span>
                    {library.length > 0 && <span className="absolute top-3 right-6 w-2.5 h-2.5 bg-blue-500 border-2 border-[#111115] rounded-full"></span>}
                </button>
                <button onClick={() => setActiveTab('credits')} className={`flex flex-col items-center gap-1.5 p-3 w-24 rounded-2xl transition-all ${activeTab === 'credits' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500'}`}>
                    <User size={24} />
                    <span className="text-[10px] font-bold tracking-widest uppercase mt-0.5">Créditos</span>
                </button>
            </nav>
        </div>
    );
}