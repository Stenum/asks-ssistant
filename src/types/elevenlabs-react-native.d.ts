declare module '@elevenlabs/react-native' {
  import type { ReactNode } from 'react';

  export type ConversationStatus =
    | 'idle'
    | 'initializing'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected'
    | 'error';

  export interface ConversationMessage {
    id: string;
    role: 'agent' | 'user' | 'system';
    text?: string;
    createdAt?: string | number | Date;
    [key: string]: unknown;
  }

  export interface ConversationTranscription {
    text: string;
    isFinal?: boolean;
    [key: string]: unknown;
  }

  export interface StartSessionOptions {
    conversationToken?: string;
    agentId?: string;
    [key: string]: unknown;
  }

  export interface UseConversationResult {
    status: ConversationStatus;
    isMuted: boolean;
    startSession(options: StartSessionOptions): Promise<void>;
    endSession(): Promise<void>;
    mute(): void;
    unmute(): void;
    on?: (
      event: 'status' | 'message' | 'transcription' | 'error',
      handler: (payload: unknown) => void
    ) => void;
    off?: (
      event: 'status' | 'message' | 'transcription' | 'error',
      handler: (payload: unknown) => void
    ) => void;
  }

  export interface ElevenLabsProviderProps {
    children: ReactNode;
  }

  export function useConversation(): UseConversationResult;
  export function ElevenLabsProvider(props: ElevenLabsProviderProps): JSX.Element;
}
