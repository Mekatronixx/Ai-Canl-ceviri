import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { VideoFeed } from './components/VideoFeed';
import { LanguageSelector } from './components/LanguageSelector';
import { AudioVisualizer } from './components/AudioVisualizer';
import { SUPPORTED_LANGUAGES, MODEL_NAME, INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE, BUFFER_SIZE } from './constants';
import { Language, ConnectionState, TranscriptItem } from './types';
import { createPcmBlob, decode, decodeAudioData } from './utils/audioUtils';

// Icons
const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>;
const MicOffIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" x2="23" y1="1" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>;
const PhoneIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>;
const PhoneOffIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" x2="1" y1="1" y2="23"/></svg>;

export default function App() {
  // State
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.IDLE);
  const [sourceLang, setSourceLang] = useState<Language>(SUPPORTED_LANGUAGES[0]); // Turkish Default
  const [targetLang, setTargetLang] = useState<Language>(SUPPORTED_LANGUAGES[1]); // English Default
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0); 
  
  // Refs for Audio Contexts and Stream Management
  const nextStartTimeRef = useRef<number>(0);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSessionRef = useRef<any>(null); // Holds the resolved active GenAI session object
  const streamRef = useRef<MediaStream | null>(null);

  // Robust cleanup function
  const stopAudioProcessing = useCallback(async () => {
    // 1. Close the Gemini Session
    if (activeSessionRef.current) {
      try {
        // Try to close gracefully
        activeSessionRef.current.close();
      } catch (e) {
        console.warn("Error closing session:", e);
      }
      activeSessionRef.current = null;
    }

    // 2. Disconnect Audio Nodes
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }

    // 3. Close Audio Contexts (Async)
    if (inputAudioContextRef.current) {
      try {
        await inputAudioContextRef.current.close();
      } catch (e) { console.warn("Input ctx close error", e); }
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      try {
        await outputAudioContextRef.current.close();
      } catch (e) { console.warn("Output ctx close error", e); }
      outputAudioContextRef.current = null;
    }

    // 4. Stop Media Stream Tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    nextStartTimeRef.current = 0;
    setAudioVolume(0);
    // We do not set IDLE here immediately, the caller handles state transitions
  }, []);

  const startLiveSession = async () => {
    if (!process.env.API_KEY) {
      alert("API Key not found in environment variables.");
      return;
    }

    // Ensure clean slate before starting
    await stopAudioProcessing();
    
    setConnectionState(ConnectionState.CONNECTING);
    setTranscripts([]);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // Setup Audio Contexts
      const InputContextClass = window.AudioContext || (window as any).webkitAudioContext;
      inputAudioContextRef.current = new InputContextClass({ sampleRate: INPUT_SAMPLE_RATE });
      outputAudioContextRef.current = new InputContextClass({ sampleRate: OUTPUT_SAMPLE_RATE });

      // Critical: Resume contexts 
      await inputAudioContextRef.current.resume();
      await outputAudioContextRef.current.resume();

      // Get Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: INPUT_SAMPLE_RATE 
        } 
      });
      streamRef.current = stream;

      // System Instruction
      const systemInstruction = `You are a translator. Translate ${sourceLang.name} to ${targetLang.name} and ${targetLang.name} to ${sourceLang.name}. Just speak the translation.`;

      // Connect to Gemini Live
      // We use a promise variable so we can capture the session later
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
        },
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            console.log("Gemini Live Connected");

            // Capture the session object so we can close it later
            sessionPromise.then(session => {
              activeSessionRef.current = session;
            });

            // Start Audio Streaming Pipeline
            if (!inputAudioContextRef.current || !streamRef.current) return;

            const source = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
            inputSourceRef.current = source;
            
            // Create a silent node to prevent feedback
            const silentNode = inputAudioContextRef.current.createGain();
            silentNode.gain.value = 0;

            const processor = inputAudioContextRef.current.createScriptProcessor(BUFFER_SIZE, 1, 1);
            scriptProcessorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Simple volume meter
              let sum = 0;
              for(let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setAudioVolume(rms * 5); 

              const pcmBlob = createPcmBlob(inputData);
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(silentNode);
            silentNode.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              try {
                const audioBuffer = await decodeAudioData(
                  decode(audioData),
                  ctx,
                  OUTPUT_SAMPLE_RATE,
                  1
                );
                
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
              } catch (e) {
                console.error("Error decoding audio output", e);
              }
            }
          },
          onclose: () => {
            console.log("Gemini Live Disconnected");
            // Only update state if we aren't already in IDLE (prevent loops)
            setConnectionState(prev => prev === ConnectionState.IDLE ? ConnectionState.IDLE : ConnectionState.DISCONNECTED);
          },
          onerror: (err) => {
            console.error("Gemini Live Error", err);
            setConnectionState(ConnectionState.ERROR);
            stopAudioProcessing();
          }
        }
      });

    } catch (error) {
      console.error("Failed to start session:", error);
      setConnectionState(ConnectionState.ERROR);
      stopAudioProcessing();
    }
  };

  const endCall = async () => {
    await stopAudioProcessing();
    setConnectionState(ConnectionState.DISCONNECTED);
    setTimeout(() => setConnectionState(ConnectionState.IDLE), 500);
  };

  const toggleMute = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-2 md:p-6 h-[100dvh]"> {/* dvh for mobile */}
      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-4 h-full">
        
        {/* MAIN CONTENT AREA (Video + Controls) */}
        <div className="lg:col-span-8 flex flex-col gap-4 h-full">
          {/* Header */}
          <header className="flex justify-between items-center shrink-0 h-12">
            <div className="flex items-center gap-2">
               <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold">
                 L
               </div>
               <h1 className="text-xl font-bold tracking-tight">LinguaLive</h1>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2 ${
              connectionState === ConnectionState.CONNECTED ? 'bg-green-500/20 text-green-400' : 
              connectionState === ConnectionState.CONNECTING ? 'bg-yellow-500/20 text-yellow-400' : 
              'bg-slate-700 text-slate-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                connectionState === ConnectionState.CONNECTED ? 'bg-green-400 animate-pulse' : 
                connectionState === ConnectionState.CONNECTING ? 'bg-yellow-400' : 
                'bg-slate-400'
              }`} />
              {connectionState === ConnectionState.CONNECTED ? 'ON AIR' : connectionState}
            </div>
          </header>

          {/* Video Container - Grows to fill space */}
          <div className="flex-1 relative bg-slate-950 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl flex flex-col min-h-0">
             {/* Video Feed */}
             <VideoFeed />
             
             {/* Mobile-friendly Overlay info */}
             {connectionState === ConnectionState.CONNECTED && (
                <div className="absolute top-4 left-0 right-0 flex justify-center z-20">
                    <div className="bg-black/60 backdrop-blur-md px-4 py-1.5 rounded-full text-xs text-white/90 border border-white/10 shadow-sm">
                      Translating: {sourceLang.nativeName} ↔ {targetLang.nativeName}
                    </div>
                </div>
             )}
          </div>

          {/* Controls Bar - Fixed height */}
          <div className="h-20 shrink-0 bg-slate-800/60 backdrop-blur-xl rounded-2xl border border-slate-700 flex items-center justify-between px-4 md:px-8 mb-2">
            <div className="flex items-center gap-4 w-1/3">
               <AudioVisualizer isActive={connectionState === ConnectionState.CONNECTED && audioVolume > 0.01} />
            </div>
            
            <div className="flex items-center gap-6 justify-center w-1/3">
              <button 
                onClick={toggleMute}
                className={`p-3 md:p-4 rounded-full transition-all duration-200 ${
                  isMuted ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                {isMuted ? <MicOffIcon /> : <MicIcon />}
              </button>
              
              {connectionState === ConnectionState.CONNECTED ? (
                 <button 
                   onClick={endCall}
                   className="p-4 md:p-5 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-xl shadow-red-900/40 transition-all scale-110 active:scale-95"
                 >
                   <PhoneOffIcon />
                 </button>
              ) : (
                <button 
                  onClick={startLiveSession}
                  disabled={connectionState === ConnectionState.CONNECTING}
                  className="p-4 md:p-5 rounded-full bg-green-600 hover:bg-green-500 text-white shadow-xl shadow-green-900/40 transition-all scale-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <PhoneIcon />
                </button>
              )}
            </div>

            <div className="w-1/3 flex justify-end text-xs text-slate-500 font-mono hidden md:flex">
               {process.env.API_KEY ? 'API KEY READY' : 'NO API KEY'}
            </div>
             <div className="w-1/3 flex justify-end md:hidden">
               {/* Spacer for mobile symmetry */}
            </div>
          </div>
        </div>

        {/* SETTINGS COLUMN (Hidden on mobile while calling to save space, or collapsible) */}
        <div className={`lg:col-span-4 bg-slate-800/40 rounded-3xl border border-slate-800 p-4 md:p-6 flex flex-col h-auto lg:h-full transition-all ${connectionState === ConnectionState.CONNECTED ? 'hidden lg:flex' : 'flex'}`}>
          <h2 className="text-xl font-bold mb-4 text-white">Translation Setup</h2>
          
          <div className="space-y-6 flex-1 overflow-y-auto">
            <div className="space-y-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
              <LanguageSelector 
                label="I Speak (Source)"
                selected={sourceLang}
                onSelect={setSourceLang}
                disabled={connectionState !== ConnectionState.IDLE}
              />
            </div>

            <div className="flex justify-center -my-3 z-10 relative opacity-70">
               <svg className="text-slate-400 rotate-90 lg:rotate-0" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10h14"/><path d="M7 14h14"/><path d="m3 10 3.5-3.5"/><path d="m3 14 3.5 3.5"/></svg>
            </div>

            <div className="space-y-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
              <LanguageSelector 
                label="Translate To (Target)"
                selected={targetLang}
                onSelect={setTargetLang}
                disabled={connectionState !== ConnectionState.IDLE}
              />
            </div>

            <div className="mt-4 p-4 rounded-xl bg-blue-900/20 border border-blue-800/30 text-sm text-blue-200">
              <p className="mb-2 font-semibold">Mobile Tip:</p>
              <p className="opacity-80">
                Install this app on your Android by tapping <span className="font-bold">⋮</span> then <span className="font-bold">Add to Home Screen</span>.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}