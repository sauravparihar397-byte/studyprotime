# 🌿 StudyCalm — Mindful Pomodoro & Study Dashboard

An achievement-focused, calm study companion designed to nurture deep work without stress.

## 🧘 Philosophy

Most productivity trackers induce anxiety with ticking clocks, harsh alerts, and guilt-driven streaks. **StudyCalm** takes a supportive, human-centered approach:

- **Positive Framing**: Celebrate every period of focused attention, whether 5 minutes or 25 minutes.
- **Daily Horizon**: A gentle 2-hour daily focus goal designed around sustainable cognitive stamina.
- **Multi-Device Awareness**: Prepared for Mac and phone study log verification.
- **Privacy-First Architecture**: Built for user privacy. Phase 2 operates locally without trackers; future phases will support secure personal authentication and encrypted private cloud storage without third-party ad networks or data selling.
- **Calm Aesthetic**: Soothing earth tones and generous whitespace designed to lower cognitive load.

---

## 🏗️ Phase 5 Scope (Mindful Polish & Themes)

This phase refines StudyCalm into an immersive, sensory-calm focus experience with respectful audio, native browser alerts, onboarding, weekly visual trends, and flexible aesthetics:

- **Web Audio API Synthesizer Chime**: Gentle harmonic chime (528 Hz fundamental and 792 Hz resonant harmonic fifth) synthesized entirely in code without external audio assets or network downloads. Strictly opt-in with header toggle.
- **Desktop Browser Notifications**: HTML5 `Notification` API integration notifying learners when focus blocks or restful pauses conclude. Strictly opt-in with explicit permission flow.
- **First-Use Onboarding Dialog**: Non-intrusive modal introducing StudyCalm's three core principles (Mindful Intervals, Gentle Daily Horizon, Showing Up Matters). Dismisses gracefully and persists in preferences.
- **Weekly Activity Timeline (7-Day Focus Flow)**: Dedicated responsive bar chart visualizing daily focus minutes across the past 7 days. Aggregated directly from the SSOT `sessionHistory` with real-time statistics (Week Total, Active Days, Daily Average).
- **Manual Light & Dark Theme Toggle**: Deep charcoal and earthy pine night palette (`[data-theme="dark"]`) designed to reduce eye strain during evening study sessions, persisting across browser sessions.
- **Independent Preferences Storage**: Separate `studycalm-preferences-v1` key isolating UI/sound preferences from core study session records.

---

## 🏗️ Phase 4 Scope (Tracking Integrity & Milestone Rewards)

- **Single Source of Truth (SSOT)**: Daily focus time and total sessions are computed directly from valid, deduplicated records in `sessionHistory`, eliminating counter drift or inflated stats across reloads.
- **Deterministic Streak Integrity Engine**: Streak is calculated directly from unique historical study calendar dates. Cannot duplicate or increment more than once per day.
- **Anti-Duplicate & Anti-Tamper Protection**: Session IDs, timestamp signatures (<45s), and duration validations ensure clean history logging without ghost entries.
- **4-Stat Summary Overview Strip**: High-level responsive dashboard metrics displaying Today's Focus Time, Daily Progress %, Current Streak, and Total Sessions.
- **Mindful Session Completed State**: Serene transition card offering mindful next actions (_Take a 5m Break_ or _Next Focus Block_) without abrupt timer snaps.
- **Milestone Achievement System**: Non-gamified milestone badges (First Step, Daily Horizon, 3-Day Rhythm, 7-Day Rooted).

---

## 🚀 How to Preview

You can preview the app using any static web browser or Python's built-in web server:

### Option 1: Direct Browser Open

Double-click `index.html` or open it in your browser:

```bash
open study-app/index.html   # On macOS
```

### Option 2: Python HTTP Server

From the root workspace or `study-app` directory:

```bash
cd study-app
python3 -m http.server 8080
```

Then navigate to `http://localhost:8080` in your web browser.

---

## 🗺️ Upcoming Roadmap (Phase 6+)

1. **Custom Focus Intervals & Soundscapes**: Ambient nature audio (gentle rain, forest stream, white noise) with Web Audio generators.
2. **Subject Tagging & Intention Categorization**: Categorize study sessions by academic subject or project.
3. **Export & Backup Tools**: JSON and CSV export/import for personal archival and data sovereignty.
4. **Offline PWA Support**: Service worker caching and installable web app manifest.
