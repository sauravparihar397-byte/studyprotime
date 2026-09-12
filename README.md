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

## 🏗️ Phase 4 Scope (Tracking Integrity & Milestone Rewards)

This phase elevates StudyCalm into a reliable, mathematically consistent study companion with trustworthy tracking and mindful milestone achievements:

- **Single Source of Truth (SSOT)**: Daily focus time and total sessions are computed directly from valid, deduplicated records in `sessionHistory`, eliminating counter drift or inflated stats across reloads.
- **Deterministic Streak Integrity Engine**: Streak is calculated directly from unique historical study calendar dates. Cannot duplicate or increment more than once per day.
- **Anti-Duplicate & Anti-Tamper Protection**: Session IDs, timestamp signatures (<15s), and duration validations ensure clean history logging without ghost entries.
- **4-Stat Summary Overview Strip**: High-level responsive dashboard metrics displaying Today's Focus Time, Daily Progress %, Current Streak, and Total Sessions.
- **Mindful Session Completed State**: Serene transition card offering mindful next actions (_Take a 5m Break_ or _Next Focus Block_) without abrupt timer snaps.
- **Milestone Achievement System**: Non-gamified milestone badges:
  - 🌱 **First Step**: First focus block completed
  - 🎯 **Daily Horizon**: 120 minutes of focus achieved in a day
  - 🌿 **3-Day Rhythm**: 3-day consecutive focus streak
  - 🏆 **7-Day Rooted**: 7-day deep focus habit
- **Backward-Compatible Storage**: Migrates existing v1 and v3 states to `studycalm-state-v4` automatically.

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

## 🗺️ Upcoming Roadmap (Phase 5+)

1. **Gentle Audio Alerts**: Tibetan singing bowl and soft chime cues on session completion.
2. **Notification & Reminder System**: Browser desktop notifications for mindful study transitions.
3. **Motivational Microcopy & Onboarding**: Gentle guided tour for new learners.
4. **Timeline & Activity Visualizations**: Weekly trend charts and focus breakdown history.
5. **Theme Customization**: Manual dark mode complementing system preferences.
