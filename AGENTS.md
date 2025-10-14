# AGENTS.md — Implementing the ElevenLabs Expo Voice Agent with an LLM Coding Agent

This document is a **precise build plan** that an autonomous coding agent can follow to implement, run, and extend the Expo/React‑Native ElevenLabs voice agent for iOS with a “hot mic on launch” experience. It assumes personal use (API key in client) but includes tasks to harden for production.

---

## 0) Project Definition

**Goal:** Expo/React‑Native app that connects to an ElevenLabs **Agent** via WebRTC and starts listening immediately when the app opens.

**Repo layout (expected):**

```
/
  package.json
  app.json
  babel.config.js
  tsconfig.json
  index.js
  src/
    App.tsx
  README.md
```

**Primary SDKs:** `@elevenlabs/react-native`, `@livekit/react-native`, `@livekit/react-native-webrtc`, Expo config plugins for WebRTC.

**iOS Target:** iOS 13+, development build (not Expo Go).

---

## 1) Inputs & Secrets

* **AGENT_ID**: ElevenLabs Agent ID (string)
* **XI_API_KEY**: ElevenLabs API key (string)

For this personal POC, they are hard‑coded in `src/App.tsx`.

---

## 2) High‑Level Tasks (LLM‑Executable)

### Task 2.1 — Install dependencies

**Action:**

* Run `npm install` in repo root.

**Success:** `node_modules` exists, `package.json` scripts resolve.

---

### Task 2.2 — Configure iOS permissions & plugins

**Action:**

* Ensure `app.json` contains:

  * `ios.infoPlist.NSMicrophoneUsageDescription`
  * WebRTC/LiveKit plugins: `@livekit/react-native-expo-plugin`, `@config-plugins/react-native-webrtc`
* Confirm iOS bundle identifier is set.

**Success:** Prebuild succeeds without missing permissions.

---

### Task 2.3 — Prebuild native projects

**Action:**

* Run `npx expo prebuild`.

**Success:** `ios/` and `android/` directories are created. No build errors.

---

### Task 2.4 — Inject credentials

**Action:**

* Open `src/App.tsx`.
* Replace placeholders:

  * `const ELEVENLABS_API_KEY = "REPLACE_WITH_YOUR_API_KEY";`
  * `const AGENT_ID = "REPLACE_WITH_YOUR_AGENT_ID";`

**Success:** Values present as non‑empty strings.

---

### Task 2.5 — Build & run on iOS

**Action:**

* Run `npx expo run:ios`.
* Accept mic permission on first launch.

**Success:** App shows status; after permission it connects to agent and you can converse.

---

## 3) Core Implementation Notes

1. **Conversation token (personal shortcut):**

   * App calls `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=AGENT_ID` with header `xi-api-key: XI_API_KEY`.
   * Response `{ token: string }`.
   * App starts session with `useConversation().startSession({ conversationToken: token })`.

2. **Hot‑mic behavior:**

   * On first mount/foreground, app calls `start()` which:

     * Requests mic permission.
     * Fetches token.
     * Starts session; continuous streaming begins.
   * On background, session is ended; on foreground, restarted.

3. **Controls:**

   * **Start/Stop** button calls `startSession()` / `endSession()`.
   * **Mute mic** toggles `conversation.setMicMuted(true/false)`.

4. **Autoplay/duplex:**

   * RN SDK manages WebRTC; require a dev client (not Expo Go).

---

## 4) Minimal Config Schema (for future automation)

```json
{
  "ios": {
    "bundleIdentifier": "string",
    "deploymentTarget": "13.0"
  },
  "elevenlabs": {
    "agentId": "string",
    "apiKey": "string",
    "authMode": "token|public|signedUrl"
  },
  "ui": {
    "autoStartOnLaunch": true,
    "autoStopOnBackground": true,
    "showMute": true
  }
}
```

---

## 5) Prompts for a Coding Agent

### 5.1 — Set credentials

**System:**

> Open `src/App.tsx`. Replace ELEVENLABS_API_KEY and AGENT_ID placeholders with the provided strings. Do not change any other code.

**Check:**

> Verify the constants are non‑empty. If empty, fail the task.

---

### 5.2 — Install & prebuild

**System:**

> Run `npm install`. Then run `npx expo prebuild`. If prebuild fails, parse the error, fix missing plugins or permissions in `app.json`, and retry until success.

**Check:**

> Confirm both `ios/` and `android/` folders are generated.

---

### 5.3 — iOS run

**System:**

> Run `npx expo run:ios`. When the app launches, confirm it requests mic permission, then transitions to “Connected”.

**Check:**

> If status remains “Connecting…” for >30s, capture logs, print the HTTP status from the token request, and fail with remediation hints.

---

## 6) Validation & Telemetry (LLM‑Runnable)

* **Connectivity smoke test:** After launch, expect `onConnect` fired once and `onStatusChange` logs stable.
* **Audio round‑trip:** Speak; expect agent ASR/response and audible TTS.
* **Mute toggle:** Toggle mute; verify agent stops hearing you.
* **Background/foreground:** Send app to background → session ends; foreground → session restarts.

Log lines to look for in Metro/Xcode:

* `Status: connected` (or equivalent)
* `Message:` frames arriving
* HTTP `200` for token endpoint

---

## 7) Error Handling Playbook

* **401 from token endpoint:** API key invalid → replace `ELEVENLABS_API_KEY`.
* **404 agent:** Wrong `AGENT_ID` → verify in dashboard.
* **Mic denied:** iOS mic permission denied → instruct user to enable in Settings.
* **Expo Go used:** WebRTC won’t initialize → ensure `expo prebuild` + dev client with `run:ios`.
* **No audio out:** Ensure device silent mode off; `AVAudioSession` category handled by SDK; retry after relaunch.

---

## 8) Hardening for Production (Optional Follow‑ups)

1. **Move auth off-device**

   * Replace client token call with a backend endpoint: `/session` → server requests `conversation/token` using `xi-api-key` and returns `{ token }`.

2. **Signed URL flow**

   * Server calls `GET /v1/convai/conversation/get-signed-url?agent_id=...` with API key.
   * App connects using returned `wss://` signed URL or token per SDK support.

3. **Public agent path**

   * If agent is public, app can call `startSession({ agentId })` directly (no API key in app).

4. **Privacy & safety**

   * Add explicit start button and consent copy.
   * Do not auto‑start mic in production builds.
   * Store no secrets in client.

---

## 9) Makefile Targets (Optional)

```
.PHONY: setup ios run clean

setup:
	npm install
	npx expo prebuild
	echo "Setup complete"

ios:
	npx expo run:ios

run:
	npm start

clean:
	rm -rf ios android node_modules
	rm -rf package-lock.json
```

---

## 10) Deliverables Checklist

* [ ] App builds on iOS with dev client
* [ ] Mic permission prompt appears on first launch
* [ ] Auto‑connects and starts listening after permission
* [ ] Mute/Unmute works
* [ ] Background stop / foreground resume works
* [ ] README.md updated with run instructions
* [ ] (Optional) Hardened auth path documented or implemented

---

## 11) Time‑boxed Troubleshooting

1. **5 min:** Ensure correct API key/agent ID; re-run.
2. **10 min:** Inspect token request logs (status/body), print error.
3. **15 min:** Confirm dev client build (not Expo Go), reinstall pods via `npx expo prebuild --clean` and `npx expo run:ios`.
4. **20+ min:** Toggle a public agent; try `startSession({ agentId })` to isolate auth.

---

## 12) Future Extensions

* CallKit UI on iOS for “phone-call” feel
* Local VAD toggle and push‑to‑talk fallback
* Session transcripts via REST pull for history
* Siri Shortcut deep link to auto-open and start

---

**End of AGENTS.md**
