import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import type {
  ConversationMessage,
  ConversationStatus,
  ConversationTranscription
} from '@elevenlabs/react-native';
import { ElevenLabsProvider, useConversation } from '@elevenlabs/react-native';

const ELEVENLABS_API_KEY = 'REPLACE_WITH_YOUR_API_KEY';
const AGENT_ID = 'REPLACE_WITH_YOUR_AGENT_ID';

// These mirror the defaults used by the ElevenLabs React Native SDK when it
// exchanges the conversation token internally. Omitting the `source` and
// `version` query params causes the backend to assume a browser client, which
// breaks the WebRTC flow on iOS.
const ELEVENLABS_SDK_SOURCE = 'react_native_sdk';
const ELEVENLABS_SDK_VERSION = '0.3.2';

interface LogEntry {
  id: string;
  message: string;
}

type PermissionState = 'unknown' | 'granted' | 'denied';

const MAX_LOG_ITEMS = 50;

async function fetchConversationToken(signal?: AbortSignal): Promise<string> {
  const query = new URLSearchParams({
    agent_id: AGENT_ID,
    source: ELEVENLABS_SDK_SOURCE,
    version: ELEVENLABS_SDK_VERSION
  });
  const url = `https://api.elevenlabs.io/v1/convai/conversation/token?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY
    },
    signal
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token request failed (${response.status}): ${body || 'Empty response body'}`);
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    throw new Error('Token response is missing a token value.');
  }

  return data.token;
}

async function ensureMicrophonePermission(): Promise<PermissionState> {
  try {
    const current = await Audio.getPermissionsAsync();
    if (current.status === 'granted') {
      return 'granted';
    }

    const updated = await Audio.requestPermissionsAsync();
    return updated.status === 'granted' ? 'granted' : 'denied';
  } catch (error) {
    console.warn('Unable to query microphone permission', error);
    return 'unknown';
  }
}

function formatTimestamp(date: Date): string {
  return `${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

const VoiceAgentScreen: React.FC = () => {
  const conversation = useConversation();
  const [connectionStatus, setConnectionStatus] = useState<ConversationStatus>('idle');
  const [permissionStatus, setPermissionStatus] = useState<PermissionState>('unknown');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const hasAutoStartedRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const startInProgressRef = useRef(false);

  const appendLog = useCallback((message: string) => {
    setLogs((previous) => {
      const entry: LogEntry = {
        id: `${Date.now()}-${Math.random()}`,
        message: `${formatTimestamp(new Date())} ${message}`
      };
      return [entry, ...previous].slice(0, MAX_LOG_ITEMS);
    });
  }, []);

  const setStatusFromConversation = useCallback(
    (status: ConversationStatus) => {
      setConnectionStatus(status);
      appendLog(`Status changed: ${status}`);
    },
    [appendLog]
  );

  useEffect(() => {
    if (!conversation) {
      return;
    }

    if (typeof conversation.status === 'string') {
      setConnectionStatus(conversation.status as ConversationStatus);
    }

    if (typeof conversation.on === 'function' && typeof conversation.off === 'function') {
      const handleStatus = (status: ConversationStatus) => setStatusFromConversation(status);
      const handleMessage = (payload: ConversationMessage) => {
        const text = payload?.text?.trim();
        if (text) {
          appendLog(`Agent: ${text}`);
        }
      };
      const handleTranscription = (payload: ConversationTranscription) => {
        const text = payload?.text?.trim();
        if (text) {
          appendLog(`You: ${text}${payload?.isFinal ? ' (final)' : ''}`);
        }
      };
      const handleError = (error: unknown) => {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        appendLog(`Error: ${message}`);
        setLastError(message);
      };

      conversation.on('status', handleStatus);
      conversation.on('message', handleMessage);
      conversation.on('transcription', handleTranscription);
      conversation.on('error', handleError);

      return () => {
        conversation.off?.('status', handleStatus);
        conversation.off?.('message', handleMessage);
        conversation.off?.('transcription', handleTranscription);
        conversation.off?.('error', handleError);
      };
    }

    return undefined;
  }, [appendLog, conversation, setStatusFromConversation]);

  const configureAudio = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true
      });
    } catch (error) {
      appendLog(`Failed to configure audio mode: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [appendLog]);

  const stopConversation = useCallback(async () => {
    if (!conversation) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (isStopping) {
      return;
    }

    setIsStopping(true);
    try {
      if (typeof conversation.endSession === 'function') {
        await conversation.endSession();
      }
      setConnectionStatus('idle');
      appendLog('Conversation stopped.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Failed to stop session: ${message}`);
      setLastError(message);
    } finally {
      setIsStopping(false);
    }
  }, [appendLog, conversation, isStopping]);

  const startConversation = useCallback(async () => {
    if (!conversation) {
      appendLog('Conversation hook unavailable; cannot start session.');
      return;
    }

    if (AppState.currentState !== 'active') {
      appendLog('App is not in the foreground; start skipped.');
      return;
    }

    if (startInProgressRef.current || isStarting) {
      return;
    }

    if (connectionStatus === 'connecting' || connectionStatus === 'connected') {
      return;
    }

    startInProgressRef.current = true;
    setIsStarting(true);
    setLastError(null);

    try {
      const permission = await ensureMicrophonePermission();
      setPermissionStatus(permission);
      if (permission !== 'granted') {
        appendLog('Microphone permission denied.');
        setLastError('Microphone permission is required to talk to the agent.');
        return;
      }

      await configureAudio();

      const controller = new AbortController();
      abortControllerRef.current = controller;
      appendLog('Requesting conversation token...');
      const token = await fetchConversationToken(controller.signal);
      appendLog('Conversation token acquired. Starting session...');

      if (typeof conversation.startSession === 'function') {
        await conversation.startSession({ conversationToken: token });
      } else {
        throw new Error('ElevenLabs conversation does not expose startSession().');
      }

      setStatusFromConversation('connecting');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Failed to start session: ${message}`);
      setLastError(message);
      await stopConversation();
    } finally {
      abortControllerRef.current = null;
      setIsStarting(false);
      startInProgressRef.current = false;
    }
  }, [appendLog, configureAudio, connectionStatus, conversation, isStarting, setStatusFromConversation, stopConversation]);

  useEffect(() => {
    if (!hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      startConversation();
    }
  }, [startConversation]);

  const handleAppStateChange = useCallback(
    (nextStatus: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = nextStatus;

      if (previous.match(/inactive|background/) && nextStatus === 'active') {
        appendLog('App entered foreground. Restarting conversation.');
        startConversation();
        return;
      }

      if (nextStatus.match(/inactive|background/) && connectionStatus !== 'idle') {
        appendLog('App moved to background. Ending conversation.');
        stopConversation();
      }
    },
    [appendLog, connectionStatus, startConversation, stopConversation]
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [handleAppStateChange]);

  const toggleMute = useCallback(() => {
    if (!conversation) {
      return;
    }

    if (conversation.isMuted) {
      if (typeof conversation.unmute === 'function') {
        conversation.unmute();
        appendLog('Microphone unmuted.');
      }
    } else if (typeof conversation.mute === 'function') {
      conversation.mute();
      appendLog('Microphone muted.');
    }
  }, [appendLog, conversation]);

  const connectionDetails = useMemo(() => {
    const metadata = [] as Array<{ label: string; value: string }>;
    if (permissionStatus !== 'granted') {
      metadata.push({ label: 'Microphone permission', value: permissionStatus });
    }
    metadata.push({ label: 'SDK status', value: connectionStatus });
    if (lastError) {
      metadata.push({ label: 'Last error', value: lastError });
    }
    metadata.push({ label: 'SDK version', value: Constants.expoConfig?.version ?? '1.0.0' });
    if (Platform.OS === 'ios') {
      metadata.push({ label: 'Platform', value: 'iOS' });
    } else if (Platform.OS === 'android') {
      metadata.push({ label: 'Platform', value: 'Android' });
    } else {
      metadata.push({ label: 'Platform', value: Platform.OS });
    }
    return metadata;
  }, [connectionStatus, lastError, permissionStatus]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <Text style={styles.title}>ElevenLabs Voice Agent</Text>
        <Text style={styles.subtitle}>Hot mic on launch. Start speaking as soon as you see Connected.</Text>

        <View style={styles.statusPill}>
          <Text style={styles.statusText}>{connectionStatus.toUpperCase()}</Text>
        </View>

        {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}

        <View style={styles.controls}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={startConversation}
            style={[styles.button, isStarting && styles.buttonDisabled]}
            disabled={isStarting || connectionStatus === 'connecting' || connectionStatus === 'connected'}
          >
            {isStarting ? <ActivityIndicator color="#0b1a2d" /> : <Text style={styles.buttonLabel}>Reconnect</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={stopConversation}
            style={[styles.button, styles.secondaryButton, isStopping && styles.buttonDisabled]}
            disabled={isStopping || connectionStatus === 'idle'}
          >
            {isStopping ? (
              <ActivityIndicator color="#0b1a2d" />
            ) : (
              <Text style={[styles.buttonLabel, styles.secondaryButtonLabel]}>Hang Up</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={toggleMute}
            style={[styles.button, styles.muteButton]}
            disabled={connectionStatus !== 'connected'}
          >
            <Text style={[styles.buttonLabel, styles.muteButtonLabel]}>
              {conversation?.isMuted ? 'Unmute' : 'Mute'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.detailsBox}>
          {connectionDetails.map(({ label, value }) => (
            <View key={label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{label}</Text>
              <Text style={styles.detailValue}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.logContainer}>
          <Text style={styles.logTitle}>Activity log</Text>
          <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent}>
            {logs.length === 0 ? (
              <Text style={styles.logEmpty}>No activity yet. Start speaking to see transcripts.</Text>
            ) : (
              logs.map((log) => (
                <Text key={log.id} style={styles.logEntry}>
                  {log.message}
                </Text>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b1a2d'
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
    backgroundColor: '#0b1a2d'
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f5f9ff',
    marginBottom: 8
  },
  subtitle: {
    color: '#c8d6f2',
    fontSize: 14,
    marginBottom: 16
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#1c2f4a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: 12
  },
  statusText: {
    color: '#7ed0ff',
    fontWeight: '600',
    letterSpacing: 1.2
  },
  errorText: {
    color: '#ff8a8a',
    marginBottom: 8
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20
  },
  button: {
    backgroundColor: '#7ed0ff',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    flexGrow: 1,
    alignItems: 'center'
  },
  buttonDisabled: {
    opacity: 0.6
  },
  buttonLabel: {
    fontWeight: '600',
    color: '#0b1a2d'
  },
  secondaryButton: {
    backgroundColor: '#193049',
    borderWidth: 1,
    borderColor: '#7ed0ff'
  },
  secondaryButtonLabel: {
    color: '#7ed0ff'
  },
  muteButton: {
    backgroundColor: '#111f33',
    borderWidth: 1,
    borderColor: '#ffbf6f'
  },
  muteButtonLabel: {
    color: '#ffbf6f'
  },
  detailsBox: {
    backgroundColor: '#111f33',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  detailLabel: {
    color: '#7a8cb1',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  detailValue: {
    color: '#f5f9ff',
    fontSize: 14,
    maxWidth: '60%'
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#111f33',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  logTitle: {
    color: '#7a8cb1',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8
  },
  logScroll: {
    flex: 1
  },
  logContent: {
    gap: 8,
    paddingBottom: 16
  },
  logEmpty: {
    color: '#3f536e'
  },
  logEntry: {
    color: '#f5f9ff',
    fontSize: 13,
    lineHeight: 18
  }
});

const App: React.FC = () => {
  return (
    <ElevenLabsProvider>
      <VoiceAgentScreen />
    </ElevenLabsProvider>
  );
};

export default App;
