# asks-ssistant

An Expo-managed React Native project that connects to an ElevenLabs Agent using the ElevenLabs React Native SDK. The app starts a WebRTC session with the agent as soon as it launches ("hot mic" experience), listens for microphone input, and streams agent responses.

## Prerequisites

- Node.js 18 or later
- `npm` 9+
- Xcode with the latest iOS SDK if you want to run on iOS
- An ElevenLabs account with an existing Agent ID and API key

## Initial setup

Install dependencies and generate the native projects:

```bash
npm install
npx expo prebuild
```

> The project uses Expo config plugins for LiveKit/WebRTC, so you must build a custom development client. Expo Go is not supported.
> We pin `@elevenlabs/react-native` to 0.3.2 with the matching LiveKit pair: `@livekit/react-native` 2.7.4 and `@livekit/react-native-webrtc` 125.0.12. This satisfies the SDK peer requirements without needing legacy peer overrides.

## Configure credentials

Open [`src/App.tsx`](src/App.tsx) and replace the placeholder strings with your credentials:

```ts
const ELEVENLABS_API_KEY = 'YOUR_API_KEY';
const AGENT_ID = 'YOUR_AGENT_ID';
```

These values are only suitable for personal testing. In production you should move the API key off-device.

## Running on iOS

Build and install a dev client on iOS:

```bash
npx expo run:ios
```

When the app launches, grant microphone permissions. The app will fetch a conversation token, connect to your ElevenLabs agent via LiveKit/WebRTC, and begin streaming audio immediately.

## Useful scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the Metro bundler |
| `npm run ios` | Build and launch the iOS development client |
| `npm run android` | Build and launch the Android development client |
| `npm run prebuild` | Generate the native `ios/` and `android/` directories |

## Troubleshooting

- **401 / 403 when requesting the conversation token** – confirm the API key is correct and has access to the agent.
- **404 agent not found** – double check the agent ID.
- **Microphone permission denied** – enable the microphone in iOS Settings for the dev client.
- **Expo Go is used** – create a dev client with `expo prebuild` and `expo run:ios` instead of Expo Go.

## Hardening for production

- Move the token exchange to a backend service so the API key is not bundled with the app.
- Introduce an explicit "Join" button and remove the automatic microphone start-up for privacy.
- Store conversation transcripts securely if you need history or analytics.
