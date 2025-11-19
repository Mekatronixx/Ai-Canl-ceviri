export interface Language {
  code: string;
  name: string;
  flag: string; // Emoji
  nativeName: string;
}

export enum ConnectionState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
  DISCONNECTED = 'DISCONNECTED'
}

export interface TranscriptItem {
  id: string;
  speaker: 'user' | 'model';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface AudioConfig {
  sampleRate: number;
}

export interface LiveConfig {
  sourceLanguage: Language;
  targetLanguage: Language;
}