"use strict";

const STORAGE_KEY = "studycalm-state-v4";
const PREV_STORAGE_KEY_V3 = "studycalm-state-v3";
const LEGACY_STORAGE_KEY = "studycalm-state-v1";
const PREFERENCES_KEY = "studycalm-preferences-v1";
const FEEDBACK_KEY = "studycalm-feedback-v1";
const FEEDBACK_FEELINGS = ["calm", "helpful", "needs-work"];
const DAILY_GOAL_MINUTES = 120;

const MODE_CONFIG = {
  focus: {
    label: "Deep Focus",
    duration: 25 * 60,
    intention: "Chapter 4 Review",
    type: "focus",
    badgeClass: "completed",
    icon: "🌿",
  },
  "short-break": {
    label: "Short Pause",
    duration: 5 * 60,
    intention: "Hydration & breathing",
    type: "break",
    badgeClass: "break",
    icon: "☕",
  },
  "long-break": {
    label: "Restful Reset",
    duration: 15 * 60,
    intention: "Walk & light stretch",
    type: "break",
    badgeClass: "break",
    icon: "🧘",
  },
};

// -----------------------------------------------------------------------------
// Date & Time Utility Helpers
// -----------------------------------------------------------------------------

function getLocalDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getYesterdayDateString(today = new Date()) {
  const d = today instanceof Date ? new Date(today) : new Date(today);
  d.setDate(d.getDate() - 1);
  return getLocalDateString(d);
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseDuration(value) {
  if (typeof value !== "string") return 0;
  const parts = value.split(":").map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function calculateProgress(completedMinutes, goalMinutes) {
  const safeCompleted = Math.max(0, completedMinutes);
  const safeGoal = Math.max(1, goalMinutes);
  return Math.min(100, Math.round((safeCompleted / safeGoal) * 100));
}

// -----------------------------------------------------------------------------
// Single Source of Truth (SSOT) Calculators
// -----------------------------------------------------------------------------

function getTodayFocusMinutes(sessionHistory, todayStr = getLocalDateString()) {
  if (!Array.isArray(sessionHistory)) return 0;
  return sessionHistory
    .filter((s) => s.type === "focus" && s.date === todayStr)
    .reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
}

function getTotalFocusSessions(sessionHistory) {
  if (!Array.isArray(sessionHistory)) return 0;
  return sessionHistory.filter((s) => s.type === "focus").length;
}

/**
 * Deterministic streak calculator computed directly from unique study calendar dates.
 * Returns { count, status, lastStudyDate }
 * status: 'active' (studied today), 'waiting' (studied yesterday, awaiting today), 'inactive' (streak broken)
 */
function calculateStreak(sessionHistory, today = new Date()) {
  if (!Array.isArray(sessionHistory) || sessionHistory.length === 0) {
    return { count: 0, status: "inactive", lastStudyDate: null };
  }

  const focusSessions = sessionHistory.filter((s) => s.type === "focus");
  if (focusSessions.length === 0) {
    return { count: 0, status: "inactive", lastStudyDate: null };
  }

  const studyDatesSet = new Set(focusSessions.map((s) => s.date));
  const todayStr = getLocalDateString(today);
  const yesterdayStr = getYesterdayDateString(today);

  const sortedDates = Array.from(studyDatesSet).sort().reverse();
  const mostRecentDate = sortedDates[0];

  let anchorDate;
  let status;

  if (studyDatesSet.has(todayStr)) {
    anchorDate = today instanceof Date ? new Date(today) : new Date(today);
    status = "active";
  } else if (studyDatesSet.has(yesterdayStr)) {
    anchorDate = today instanceof Date ? new Date(today) : new Date(today);
    anchorDate.setDate(anchorDate.getDate() - 1);
    status = "waiting";
  } else {
    return { count: 0, status: "inactive", lastStudyDate: mostRecentDate };
  }

  let count = 0;
  const runner = new Date(anchorDate);

  while (true) {
    const checkStr = getLocalDateString(runner);
    if (studyDatesSet.has(checkStr)) {
      count++;
      runner.setDate(runner.getDate() - 1);
    } else {
      break;
    }
  }

  return {
    count,
    status,
    lastStudyDate: mostRecentDate,
  };
}

/**
 * Milestone status computed directly from session history
 */
function getMilestones(sessionHistory, todayStr = getLocalDateString()) {
  const totalSessions = getTotalFocusSessions(sessionHistory);
  const todayMinutes = getTodayFocusMinutes(sessionHistory, todayStr);
  const streak = calculateStreak(sessionHistory);

  return {
    firstStep: totalSessions >= 1,
    dailyGoal: todayMinutes >= DAILY_GOAL_MINUTES,
    streak3: streak.count >= 3,
    streak7: streak.count >= 7,
    todayMinutes,
    totalSessions,
    streakCount: streak.count,
    streakStatus: streak.status,
  };
}

/**
 * Computes 7-day focus activity rhythm ending on the specified date.
 * Returns { days: Array<{ dateStr, dayLabel, minutes, isToday }>, weekTotal, activeDays, dailyAvg }
 */
function getWeeklyTimelineData(sessionHistory, referenceDate = new Date()) {
  const ref =
    referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const todayStr = getLocalDateString(ref);
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(ref);
    d.setDate(ref.getDate() - i);
    const dateStr = getLocalDateString(d);
    const dayLabel = d.toLocaleDateString("en-US", { weekday: "short" });
    const isToday = dateStr === todayStr;

    const minutes = Array.isArray(sessionHistory)
      ? sessionHistory
          .filter((s) => s.type === "focus" && s.date === dateStr)
          .reduce((sum, s) => sum + (Number(s.duration) || 0), 0)
      : 0;

    days.push({ dateStr, dayLabel, minutes, isToday });
  }

  const weekTotal = days.reduce((sum, d) => sum + d.minutes, 0);
  const activeDays = days.filter((d) => d.minutes > 0).length;
  const dailyAvg = Math.round(weekTotal / 7);

  return { days, weekTotal, activeDays, dailyAvg };
}

/**
 * Multi-layer history deduplication:
 * 1. Checks exact IDs
 * 2. Checks same date + type with completedAt timestamp within 45 seconds
 * 3. Checks identical date + type + display time + duration
 */
function deduplicateHistory(history) {
  if (!Array.isArray(history)) return [];

  const seenIds = new Set();
  const deduped = [];

  for (const entry of history) {
    if (!entry || typeof entry.date !== "string" || !entry.duration) continue;

    const id = String(entry.id || "").trim();
    if (id && seenIds.has(id)) {
      continue;
    }

    const type = entry.type || (entry.mode === "focus" ? "focus" : "break");
    const duration = Number(entry.duration) || 25;
    const completedAt = Number(entry.completedAt) || 0;
    const time = String(entry.time || "").trim();
    const date = String(entry.date).trim();

    const isDuplicate = deduped.some((existing) => {
      if (existing.date !== date || existing.type !== type) return false;

      // Close timestamp proximity
      if (completedAt > 0 && existing.completedAt > 0) {
        if (Math.abs(completedAt - existing.completedAt) < 45000) {
          return true;
        }
      }

      // Identical display time and duration
      if (
        time &&
        existing.time &&
        time === existing.time &&
        existing.duration === duration
      ) {
        return true;
      }

      return false;
    });

    if (!isDuplicate) {
      if (id) seenIds.add(id);
      deduped.push({
        id:
          id ||
          `sess_${completedAt || Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        mode: entry.mode || (type === "break" ? "short-break" : "focus"),
        title:
          entry.title || (type === "break" ? "Mindful Pause" : "Deep Focus"),
        duration,
        time: time || "Earlier",
        date,
        type,
        completedAt: completedAt || Date.now(),
      });
    }
  }

  return deduped;
}

// -----------------------------------------------------------------------------
// State Definition & Persistence
// -----------------------------------------------------------------------------

function createDefaultState() {
  return {
    version: 4,
    selectedMode: "focus",
    remainingSeconds: MODE_CONFIG.focus.duration,
    isRunning: false,
    targetEndTime: null,
    activeSessionId: null,
    acknowledgedMilestones: {
      firstStep: false,
      dailyGoal: false,
      streak3: false,
      streak7: false,
    },
    sessionHistory: [],
    lastUpdatedAt: Date.now(),
  };
}

let state = createDefaultState();
let timerIntervalId = null;
let isCompletingCycle = false;
let sessionCompletedPending = false;

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Safe Storage Fallback Wrapper (Graceful Degradation)
// -----------------------------------------------------------------------------

const memoryStorage = {};
const safeStorage = {
  getItem(key) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {
      console.warn(`Storage read notice for "${key}":`, e);
    }
    return memoryStorage[key] !== undefined ? memoryStorage[key] : null;
  },
  setItem(key, value) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch (e) {
      console.warn(`Storage write notice for "${key}":`, e);
    }
    memoryStorage[key] = String(value);
  },
};

// -----------------------------------------------------------------------------
// Phase 5 Preferences Management (Theme, Audio, Notifications, Onboarding)
// -----------------------------------------------------------------------------

function createDefaultPreferences() {
  return {
    theme: "light",
    soundEnabled: false,
    notificationsEnabled: false,
    onboardingDismissed: false,
  };
}

let preferences = createDefaultPreferences();

function loadPreferences() {
  try {
    const raw = safeStorage.getItem(PREFERENCES_KEY);
    if (!raw) return createDefaultPreferences();
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme === "dark" ? "dark" : "light",
      soundEnabled: Boolean(parsed.soundEnabled),
      notificationsEnabled: Boolean(parsed.notificationsEnabled),
      onboardingDismissed: Boolean(parsed.onboardingDismissed),
    };
  } catch (e) {
    return createDefaultPreferences();
  }
}

function savePreferences() {
  try {
    safeStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (e) {
    console.warn("Unable to save preferences", e);
  }
}

if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  window.addEventListener("DOMContentLoaded", () => {
    preferences = loadPreferences();
    restoreState();
    initNavigation();
    initModeSelector();
    initTimerControls();
    initSessionCompletedControls();
    initHeaderControls();
    initOnboarding();
    initDataTransferControls();
    initFeedbackControls();
    render();
    console.log("🌿 StudyCalm SSOT state engine initialized successfully.");
  });
}

function loadState() {
  try {
    let raw = safeStorage.getItem(STORAGE_KEY);
    let prevRaw = null;
    let legacyRaw = null;

    if (!raw) {
      prevRaw = safeStorage.getItem(PREV_STORAGE_KEY_V3);
      if (!prevRaw) {
        legacyRaw = safeStorage.getItem(LEGACY_STORAGE_KEY);
      }
    }

    if (!raw && !prevRaw && !legacyRaw) {
      return createDefaultState();
    }

    const parsed = raw
      ? JSON.parse(raw)
      : prevRaw
        ? JSON.parse(prevRaw)
        : JSON.parse(legacyRaw);

    const selectedMode = MODE_CONFIG[parsed.selectedMode]
      ? parsed.selectedMode
      : "focus";
    const modeDuration = MODE_CONFIG[selectedMode].duration;

    const dedupedHistory = deduplicateHistory(parsed.sessionHistory);

    const acknowledgedMilestones = {
      firstStep: Boolean(parsed.acknowledgedMilestones?.firstStep),
      dailyGoal: Boolean(parsed.acknowledgedMilestones?.dailyGoal),
      streak3: Boolean(parsed.acknowledgedMilestones?.streak3),
      streak7: Boolean(parsed.acknowledgedMilestones?.streak7),
    };

    return {
      version: 4,
      selectedMode,
      remainingSeconds:
        Number.isFinite(parsed.remainingSeconds) && parsed.remainingSeconds >= 0
          ? parsed.remainingSeconds
          : modeDuration,
      isRunning: Boolean(parsed.isRunning),
      targetEndTime: Number.isFinite(parsed.targetEndTime)
        ? parsed.targetEndTime
        : null,
      activeSessionId:
        typeof parsed.activeSessionId === "string"
          ? parsed.activeSessionId
          : null,
      acknowledgedMilestones,
      sessionHistory: dedupedHistory,
      lastUpdatedAt: Number.isFinite(parsed.lastUpdatedAt)
        ? parsed.lastUpdatedAt
        : Date.now(),
    };
  } catch (error) {
    console.warn("Unable to restore saved study state", error);
    return createDefaultState();
  }
}

function saveState() {
  try {
    safeStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 4,
        selectedMode: state.selectedMode,
        remainingSeconds: state.remainingSeconds,
        isRunning: state.isRunning,
        targetEndTime: state.targetEndTime,
        activeSessionId: state.activeSessionId,
        acknowledgedMilestones: state.acknowledgedMilestones,
        sessionHistory: state.sessionHistory,
        lastUpdatedAt: Date.now(),
      }),
    );
  } catch (error) {
    console.warn("Unable to save study state", error);
  }
}

function createExportPayload() {
  return {
    app: "StudyCalm",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    state: {
      version: 4,
      selectedMode: state.selectedMode,
      remainingSeconds: state.remainingSeconds,
      isRunning: state.isRunning,
      targetEndTime: state.targetEndTime,
      activeSessionId: state.activeSessionId,
      acknowledgedMilestones: state.acknowledgedMilestones,
      sessionHistory: state.sessionHistory,
      lastUpdatedAt: state.lastUpdatedAt,
    },
    preferences: {
      theme: preferences.theme,
      soundEnabled: preferences.soundEnabled,
      notificationsEnabled: preferences.notificationsEnabled,
      onboardingDismissed: preferences.onboardingDismissed,
    },
  };
}

function normalizeImportedState(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Backup must contain a JSON object.");
  }

  const importedState =
    payload.state && typeof payload.state === "object"
      ? payload.state
      : payload;

  if (!Array.isArray(importedState.sessionHistory)) {
    throw new Error("Backup does not contain valid session history.");
  }

  const selectedMode = MODE_CONFIG[importedState.selectedMode]
    ? importedState.selectedMode
    : "focus";
  const defaultState = createDefaultState();

  return {
    ...defaultState,
    selectedMode,
    remainingSeconds:
      Number.isFinite(importedState.remainingSeconds) &&
      importedState.remainingSeconds >= 0
        ? importedState.remainingSeconds
        : MODE_CONFIG[selectedMode].duration,
    isRunning: false,
    targetEndTime: null,
    activeSessionId: null,
    acknowledgedMilestones: {
      firstStep: Boolean(importedState.acknowledgedMilestones?.firstStep),
      dailyGoal: Boolean(importedState.acknowledgedMilestones?.dailyGoal),
      streak3: Boolean(importedState.acknowledgedMilestones?.streak3),
      streak7: Boolean(importedState.acknowledgedMilestones?.streak7),
    },
    sessionHistory: deduplicateHistory(importedState.sessionHistory).slice(
      0,
      30,
    ),
    lastUpdatedAt: Date.now(),
  };
}

function normalizeImportedPreferences(importedPreferences) {
  if (!importedPreferences || typeof importedPreferences !== "object") {
    return createDefaultPreferences();
  }

  return {
    theme: importedPreferences.theme === "dark" ? "dark" : "light",
    soundEnabled: Boolean(importedPreferences.soundEnabled),
    notificationsEnabled: Boolean(importedPreferences.notificationsEnabled),
    onboardingDismissed: Boolean(importedPreferences.onboardingDismissed),
  };
}

function exportStudyData() {
  try {
    const blob = new Blob([JSON.stringify(createExportPayload(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `studycalm-backup-${getLocalDateString()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Your private StudyCalm backup was exported.");
  } catch (error) {
    console.warn("Unable to export study data", error);
    showToast("Study data could not be exported in this browser.");
  }
}

async function importStudyData(file) {
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    const importedState = normalizeImportedState(payload);
    const importedPreferences = normalizeImportedPreferences(
      payload.preferences,
    );

    clearInterval(timerIntervalId);
    timerIntervalId = null;
    state = importedState;
    preferences = importedPreferences;
    saveState();
    savePreferences();
    applyTheme(preferences.theme);
    updateSoundButtonUI();
    updateNotificationButtonUI();
    hideSessionCompletedPanel();
    render();
    showToast("StudyCalm backup restored successfully.");
  } catch (error) {
    console.warn("Unable to import study data", error);
    showToast("That backup file is invalid or could not be read.");
  }
}

function initDataTransferControls() {
  const exportBtn = document.getElementById("exportDataBtn");
  const importBtn = document.getElementById("importDataBtn");
  const input = document.getElementById("importDataInput");

  if (exportBtn && exportBtn.dataset.initialized !== "true") {
    exportBtn.dataset.initialized = "true";
    exportBtn.addEventListener("click", exportStudyData);
  }

  if (importBtn && input && importBtn.dataset.initialized !== "true") {
    importBtn.dataset.initialized = "true";
    importBtn.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const [file] = input.files || [];
      importStudyData(file);
      input.value = "";
    });
  }
}

function loadFeedbackNotes() {
  try {
    const raw = safeStorage.getItem(FEEDBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.notes)) return [];
    return parsed.notes.filter(
      (note) =>
        note &&
        typeof note.id === "string" &&
        FEEDBACK_FEELINGS.includes(note.feeling),
    );
  } catch (error) {
    console.warn("Unable to restore feedback notes", error);
    return [];
  }
}

function saveFeedbackNotes(notes) {
  safeStorage.setItem(
    FEEDBACK_KEY,
    JSON.stringify({
      app: "StudyCalm",
      version: 1,
      notes: notes.slice(0, 50),
    }),
  );
}

function createFeedbackEntry(feeling, comment) {
  const normalizedFeeling = FEEDBACK_FEELINGS.includes(feeling)
    ? feeling
    : null;
  const normalizedComment =
    typeof comment === "string" ? comment.trim().slice(0, 500) : "";

  if (!normalizedFeeling) {
    throw new Error("Choose how StudyCalm is feeling before saving a note.");
  }

  return {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    feeling: normalizedFeeling,
    comment: normalizedComment,
  };
}

function updateFeedbackStatus() {
  const status = document.getElementById("feedbackStatus");
  if (!status) return;
  const count = loadFeedbackNotes().length;
  status.textContent = `${count} ${count === 1 ? "note" : "notes"} saved locally`;
}

function submitFeedback(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const feeling = formData.get("feeling");
  const comment = formData.get("comment");

  try {
    const entry = createFeedbackEntry(feeling, comment);
    const notes = [entry, ...loadFeedbackNotes()].slice(0, 50);
    saveFeedbackNotes(notes);
    form.reset();
    updateFeedbackStatus();
    showToast("Your private StudyCalm note was saved on this device.");
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : "That note could not be saved.",
    );
  }
}

function exportFeedbackNotes() {
  const notes = loadFeedbackNotes();
  if (notes.length === 0) {
    showToast("No feedback notes to download yet.");
    return;
  }

  try {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            app: "StudyCalm",
            type: "feedback-notes",
            exportedAt: new Date().toISOString(),
            notes,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `studycalm-feedback-${getLocalDateString()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Your private feedback notes were downloaded.");
  } catch (error) {
    console.warn("Unable to export feedback notes", error);
    showToast("Feedback notes could not be downloaded in this browser.");
  }
}

function initFeedbackControls() {
  const form = document.getElementById("feedbackForm");
  const exportBtn = document.getElementById("exportFeedbackBtn");

  if (form && form.dataset.initialized !== "true") {
    form.dataset.initialized = "true";
    form.addEventListener("submit", submitFeedback);
  }

  if (exportBtn && exportBtn.dataset.initialized !== "true") {
    exportBtn.dataset.initialized = "true";
    exportBtn.addEventListener("click", exportFeedbackNotes);
  }

  updateFeedbackStatus();
}

function restoreState() {
  const loaded = loadState();
  state = loaded;

  if (state.isRunning && state.targetEndTime) {
    const now = Date.now();
    if (now >= state.targetEndTime) {
      // Session finished while tab/browser was closed
      state.remainingSeconds = 0;
      completeFocusCycle(true);
    } else {
      // Session is still active; calculate remaining seconds and restart ticker
      state.remainingSeconds = Math.max(
        0,
        Math.ceil((state.targetEndTime - now) / 1000),
      );
      startTicker();
    }
  } else {
    state.isRunning = false;
    state.targetEndTime = null;
  }

  saveState();
}

// -----------------------------------------------------------------------------
// UI Navigation & Mode Selection
// -----------------------------------------------------------------------------

function initNavigation() {
  const navLinks = document.querySelectorAll(".main-nav .nav-link");

  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.forEach((item) => item.classList.remove("active"));
      link.classList.add("active");

      const targetId = link.getAttribute("href");
      if (targetId && targetId.startsWith("#")) {
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  });
}

function initModeSelector() {
  const modeButtons = document.querySelectorAll(".mode-btn");

  modeButtons.forEach((button) => {
    const modeKey = button.dataset.mode;
    button.addEventListener("click", () => {
      if (!MODE_CONFIG[modeKey]) return;

      hideSessionCompletedPanel();

      modeButtons.forEach((item) =>
        item.classList.toggle("active", item === button),
      );

      state.selectedMode = modeKey;
      state.remainingSeconds = MODE_CONFIG[state.selectedMode].duration;
      state.isRunning = false;
      state.targetEndTime = null;
      state.activeSessionId = null;

      clearInterval(timerIntervalId);
      timerIntervalId = null;

      stopNotificationPulse();
      saveState();
      render();

      showToast(
        `Selected ${MODE_CONFIG[state.selectedMode].label} (${formatDuration(state.remainingSeconds)}).`,
      );
    });
  });
}

function initTimerControls() {
  const startBtn =
    document.getElementById("startTimerBtn") ||
    document.getElementById("startTimerPlaceholder");
  const resetBtn =
    document.getElementById("resetTimerBtn") ||
    document.getElementById("resetTimerPlaceholder");

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      hideSessionCompletedPanel();
      if (state.isRunning) {
        pauseTimer();
      } else {
        resumeTimer();
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      hideSessionCompletedPanel();
      resetCurrentTimer();
    });
  }
}

function initSessionCompletedControls() {
  const breakBtn = document.getElementById("completedTakeBreakBtn");
  const nextFocusBtn = document.getElementById("completedNextFocusBtn");

  if (breakBtn) {
    breakBtn.addEventListener("click", () => {
      hideSessionCompletedPanel();
      selectMode("short-break");
      resumeTimer();
    });
  }

  if (nextFocusBtn) {
    nextFocusBtn.addEventListener("click", () => {
      hideSessionCompletedPanel();
      selectMode("focus");
      resumeTimer();
    });
  }
}

function selectMode(modeKey) {
  if (!MODE_CONFIG[modeKey]) return;
  state.selectedMode = modeKey;
  state.remainingSeconds = MODE_CONFIG[modeKey].duration;
  state.isRunning = false;
  state.targetEndTime = null;
  state.activeSessionId = null;

  clearInterval(timerIntervalId);
  timerIntervalId = null;
  stopNotificationPulse();

  const modeButtons = document.querySelectorAll(".mode-btn");
  modeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === modeKey);
  });

  saveState();
  render();
}

function showSessionCompletedPanel(modeConfig) {
  const panel = document.getElementById("sessionCompletedPanel");
  const title = document.getElementById("completedTitle");
  const subtext = document.getElementById("completedSubtext");

  if (!panel) return;

  sessionCompletedPending = true;

  if (title) {
    title.textContent =
      modeConfig.type === "focus"
        ? "Deep Focus Session Completed"
        : `${modeConfig.label} Completed`;
  }

  if (subtext) {
    subtext.textContent =
      modeConfig.type === "focus"
        ? `${Math.round(modeConfig.duration / 60)} minutes of mindful focus recorded to your daily horizon.`
        : "Rest and reset complete. Ready to return with fresh focus.";
  }

  panel.hidden = false;
}

function hideSessionCompletedPanel() {
  const panel = document.getElementById("sessionCompletedPanel");
  if (panel) {
    panel.hidden = true;
  }
  sessionCompletedPending = false;
}

// -----------------------------------------------------------------------------
// Timer Execution Engine
// -----------------------------------------------------------------------------

function resumeTimer() {
  if (state.isRunning) return;

  hideSessionCompletedPanel();

  if (state.remainingSeconds <= 0) {
    state.remainingSeconds = MODE_CONFIG[state.selectedMode].duration;
  }

  // Bind a unique idempotency ID for this session if not already set
  if (!state.activeSessionId) {
    state.activeSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  state.isRunning = true;
  state.targetEndTime = Date.now() + state.remainingSeconds * 1000;
  state.lastUpdatedAt = Date.now();

  saveState();
  startTicker();
  render();
}

function startTicker() {
  clearInterval(timerIntervalId);
  startNotificationPulse();

  let tickCount = 0;
  timerIntervalId = setInterval(() => {
    if (!state.isRunning || !state.targetEndTime) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
      return;
    }

    const now = Date.now();
    const diffMs = state.targetEndTime - now;
    const secondsLeft = Math.max(0, Math.ceil(diffMs / 1000));

    state.remainingSeconds = secondsLeft;
    state.lastUpdatedAt = now;

    if (secondsLeft <= 0) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
      completeFocusCycle(false);
    } else {
      renderTimerDigits();
      tickCount++;
      if (tickCount % 4 === 0) {
        saveState();
      }
    }
  }, 250);
}

function pauseTimer() {
  if (!state.isRunning) return;

  clearInterval(timerIntervalId);
  timerIntervalId = null;

  if (state.targetEndTime) {
    const diffMs = state.targetEndTime - Date.now();
    state.remainingSeconds = Math.max(0, Math.ceil(diffMs / 1000));
  }

  state.isRunning = false;
  state.targetEndTime = null;
  state.lastUpdatedAt = Date.now();

  stopNotificationPulse();
  saveState();
  render();
  showToast("Session paused. Take a breath and resume when ready.");
}

function resetCurrentTimer() {
  clearInterval(timerIntervalId);
  timerIntervalId = null;

  state.isRunning = false;
  state.targetEndTime = null;
  state.activeSessionId = null;
  state.remainingSeconds = MODE_CONFIG[state.selectedMode].duration;
  state.lastUpdatedAt = Date.now();

  stopNotificationPulse();
  hideSessionCompletedPanel();
  saveState();
  render();
  showToast("Timer reset to the start of this interval.");
}

// -----------------------------------------------------------------------------
// Cycle Completion & Anti-Duplicate Processing
// -----------------------------------------------------------------------------

function completeFocusCycle(fromReload = false) {
  if (isCompletingCycle) return;
  isCompletingCycle = true;

  try {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
    state.isRunning = false;
    state.targetEndTime = null;
    stopNotificationPulse();

    const currentMode = state.selectedMode;
    const modeConfig = MODE_CONFIG[currentMode];
    const durationMinutes = Math.round(modeConfig.duration / 60);
    const now = new Date();
    const today = getLocalDateString(now);

    const milestonesBefore = getMilestones(state.sessionHistory, today);

    // Use established activeSessionId or create a new deterministic one
    const sessionId =
      state.activeSessionId ||
      `sess_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;

    const timeDisplay = now.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });

    // Anti-duplicate verification: check by ID or within 45-second window
    const alreadyLogged = state.sessionHistory.some(
      (entry) =>
        entry.id === sessionId ||
        (entry.date === today &&
          entry.type === modeConfig.type &&
          Math.abs((entry.completedAt || 0) - now.getTime()) < 45000),
    );

    if (!alreadyLogged) {
      state.sessionHistory.unshift({
        id: sessionId,
        mode: currentMode,
        title: modeConfig.label,
        duration: durationMinutes,
        time: timeDisplay,
        date: today,
        completedAt: now.getTime(),
        type: modeConfig.type,
      });

      // Keep recent 30 entries, strictly deduplicated
      state.sessionHistory = deduplicateHistory(state.sessionHistory).slice(
        0,
        30,
      );
    }

    state.activeSessionId = null;
    state.remainingSeconds = modeConfig.duration;
    state.lastUpdatedAt = Date.now();

    saveState();
    render();

    if (!fromReload) {
      const milestonesAfter = getMilestones(state.sessionHistory, today);

      // Check new milestone unlocks
      if (
        milestonesAfter.firstStep &&
        !milestonesBefore.firstStep &&
        !state.acknowledgedMilestones.firstStep
      ) {
        state.acknowledgedMilestones.firstStep = true;
        showToast(
          "🌱 Achievement Unlocked: First Step — Showing up matters.",
          "milestone",
        );
      }

      if (
        milestonesAfter.dailyGoal &&
        !milestonesBefore.dailyGoal &&
        !state.acknowledgedMilestones.dailyGoal
      ) {
        state.acknowledgedMilestones.dailyGoal = true;
        showToast(
          "🎯 Achievement Unlocked: Daily Horizon Fulfilled (120 mins)!",
          "milestone",
        );
      }

      if (
        milestonesAfter.streak3 &&
        !milestonesBefore.streak3 &&
        !state.acknowledgedMilestones.streak3
      ) {
        state.acknowledgedMilestones.streak3 = true;
        showToast(
          "🌿 Achievement Unlocked: 3-Day Rhythm — Consistency taking root.",
          "milestone",
        );
      }

      if (
        milestonesAfter.streak7 &&
        !milestonesBefore.streak7 &&
        !state.acknowledgedMilestones.streak7
      ) {
        state.acknowledgedMilestones.streak7 = true;
        showToast(
          "🏆 Achievement Unlocked: 7-Day Rooted — Deep focus habit.",
          "milestone",
        );
      }

      saveState();
      showSessionCompletedPanel(modeConfig);

      // Mindful audio chime & desktop notification
      playMindfulChime();

      if (modeConfig.type === "focus") {
        sendBrowserNotification(
          "StudyCalm 🌿 Focus Block Complete",
          "Time for a peaceful 5-minute pause. Great dedication!",
        );
        showToast(
          "🌿 Focus block complete. Time for a peaceful pause.",
          "milestone",
        );
      } else {
        sendBrowserNotification(
          `StudyCalm ☕ ${modeConfig.label} Complete`,
          "Ready to return to deep focus with fresh energy.",
        );
        showToast(
          `☕ ${modeConfig.label} complete. Ready to return with fresh focus.`,
        );
      }
    }
  } finally {
    isCompletingCycle = false;
  }
}

// -----------------------------------------------------------------------------
// DOM Rendering
// -----------------------------------------------------------------------------

function getEncouragementText(completedMinutes, goalMinutes) {
  const percent = calculateProgress(completedMinutes, goalMinutes);
  if (percent >= 100) {
    return `🌟 <strong id="progressValue">${percent}%</strong> of your daily goal achieved! Outstanding mindful dedication today.`;
  }
  if (percent >= 50) {
    return `✨ <strong id="progressValue">${percent}%</strong> complete! You're over halfway toward your 2-hour daily horizon.`;
  }
  if (percent > 0) {
    return `🌱 <strong id="progressValue">${percent}%</strong> of your daily goal is complete. Keep your rhythm gentle and steady.`;
  }
  return `🌟 <strong id="progressValue">0%</strong> of your daily focus goal complete. Ready to begin whenever you are.`;
}

function renderTimerDigits() {
  const timerDisplay = document.getElementById("timerDisplay");
  if (timerDisplay) {
    timerDisplay.textContent = formatDuration(state.remainingSeconds);
  }

  const ringProgress = document.querySelector(".ring-progress");
  if (ringProgress) {
    const circleRadius = 96;
    const circumference = 2 * Math.PI * circleRadius;
    const totalDuration = MODE_CONFIG[state.selectedMode].duration;
    const durationRatio = Math.max(0, state.remainingSeconds / totalDuration);
    const dashOffset = circumference * (1 - durationRatio);
    ringProgress.style.strokeDasharray = String(circumference);
    ringProgress.style.strokeDashoffset = String(dashOffset);
  }
}

function render() {
  renderTimerDigits();

  // SSOT Computed Values
  const todayStr = getLocalDateString();
  const milestones = getMilestones(state.sessionHistory, todayStr);
  const todayMinutes = milestones.todayMinutes;
  const totalFocusSessions = milestones.totalSessions;
  const streakCount = milestones.streakCount;
  const streakStatus = milestones.streakStatus;
  const progressPercent = calculateProgress(todayMinutes, DAILY_GOAL_MINUTES);

  // Timer Intention & Mode Labels
  const timerIntention = document.getElementById("timerIntention");
  if (timerIntention) {
    timerIntention.textContent = `Focus: ${MODE_CONFIG[state.selectedMode].intention}`;
  }

  const currentModeLabel = document.getElementById("currentModeLabel");
  if (currentModeLabel) {
    currentModeLabel.textContent = MODE_CONFIG[state.selectedMode].label;
  }

  // Summary Metrics Strip
  const summaryTodayTime = document.getElementById("summaryTodayTime");
  if (summaryTodayTime) {
    summaryTodayTime.textContent = `${todayMinutes} mins`;
  }

  const summaryTodayGoal = document.getElementById("summaryTodayGoal");
  if (summaryTodayGoal) {
    summaryTodayGoal.textContent = `Goal: ${DAILY_GOAL_MINUTES} mins`;
  }

  const summaryProgressPercent = document.getElementById(
    "summaryProgressPercent",
  );
  if (summaryProgressPercent) {
    summaryProgressPercent.textContent = `${progressPercent}%`;
  }

  const summaryProgressSub = document.getElementById("summaryProgressSub");
  if (summaryProgressSub) {
    summaryProgressSub.textContent =
      progressPercent >= 100
        ? "Daily Horizon Achieved"
        : `${Math.max(0, DAILY_GOAL_MINUTES - todayMinutes)}m remaining`;
  }

  const summaryStreakCount = document.getElementById("summaryStreakCount");
  if (summaryStreakCount) {
    summaryStreakCount.textContent = `${streakCount} ${streakCount === 1 ? "Day" : "Days"}`;
  }

  const summaryStreakSub = document.getElementById("summaryStreakSub");
  if (summaryStreakSub) {
    summaryStreakSub.textContent =
      streakStatus === "active"
        ? "Logged Today ✨"
        : streakStatus === "waiting"
          ? "Log a session today"
          : "Ready to start";
  }

  const summaryTotalSessions = document.getElementById("summaryTotalSessions");
  if (summaryTotalSessions) {
    summaryTotalSessions.textContent = `${totalFocusSessions} ${totalFocusSessions === 1 ? "Session" : "Sessions"}`;
  }

  const summaryTotalSessionsSub = document.getElementById(
    "summaryTotalSessionsSub",
  );
  if (summaryTotalSessionsSub) {
    summaryTotalSessionsSub.textContent = "Completed Blocks";
  }

  // Daily Goal Card
  const focusMinutesValue = document.getElementById("focusMinutesValue");
  if (focusMinutesValue) {
    focusMinutesValue.textContent = String(todayMinutes);
  }

  const focusGoalValue = document.getElementById("focusGoalValue");
  if (focusGoalValue) {
    focusGoalValue.textContent = String(DAILY_GOAL_MINUTES);
  }

  const progressValue = document.getElementById("progressValue");
  if (progressValue) {
    progressValue.textContent = `${progressPercent}%`;
  }

  const progressFill = document.querySelector(".progress-bar-fill");
  if (progressFill) {
    progressFill.style.width = `${progressPercent}%`;
  }

  const progressBar = document.querySelector(".progress-bar-rail");
  if (progressBar) {
    progressBar.setAttribute("aria-valuenow", String(todayMinutes));
    progressBar.setAttribute(
      "aria-valuetext",
      `${todayMinutes} of ${DAILY_GOAL_MINUTES} minutes completed (${progressPercent}% of daily goal)`,
    );
  }

  const encouragementEl = document.getElementById("encouragementText");
  if (encouragementEl) {
    encouragementEl.innerHTML = getEncouragementText(
      todayMinutes,
      DAILY_GOAL_MINUTES,
    );
  }

  const sessionCountValue = document.getElementById("sessionCountValue");
  if (sessionCountValue) {
    sessionCountValue.textContent = `${totalFocusSessions} ${totalFocusSessions === 1 ? "session" : "sessions"}`;
  }

  // Streak Banner in Welcome Section
  const streakDisplay = document.getElementById("streakDisplay");
  if (streakDisplay) {
    if (streakStatus === "active") {
      streakDisplay.textContent = `${streakCount} ${streakCount === 1 ? "day" : "days"} of calm dedication (Logged today)`;
    } else if (streakStatus === "waiting") {
      streakDisplay.textContent = `${streakCount} ${streakCount === 1 ? "day" : "days"} streak • Log a session today to continue`;
    } else {
      streakDisplay.textContent = "0 days • Start your first focus block today";
    }
  }

  const streakPill = document.getElementById("streakPill");
  if (streakPill) {
    streakPill.textContent =
      streakStatus === "active"
        ? "Logged Today"
        : streakStatus === "waiting"
          ? "Active Streak"
          : "Ready";
  }

  // Timer Controls Buttons & State
  const startBtn =
    document.getElementById("startTimerBtn") ||
    document.getElementById("startTimerPlaceholder");
  if (startBtn) {
    const isPaused =
      !state.isRunning &&
      state.remainingSeconds < MODE_CONFIG[state.selectedMode].duration;
    startBtn.innerHTML = state.isRunning
      ? '<span class="btn-icon" aria-hidden="true">❚❚</span><span>Pause Session</span>'
      : `<span class="btn-icon" aria-hidden="true">▶</span><span>${isPaused ? "Resume Session" : "Start Session"}</span>`;
    startBtn.setAttribute(
      "aria-label",
      state.isRunning
        ? "Pause the current study session"
        : isPaused
          ? "Resume the current study session"
          : "Start the current study session",
    );
  }

  const modeButtons = document.querySelectorAll(".mode-btn");
  modeButtons.forEach((button) => {
    const modeKey = button.dataset.mode;
    button.classList.toggle("active", modeKey === state.selectedMode);
  });

  const statusText = document.querySelector(".status-text");
  if (statusText) {
    statusText.textContent = state.isRunning
      ? "Focus in progress"
      : sessionCompletedPending
        ? "Block complete"
        : "Ready for focus";
  }

  // Milestone Badges Showcase
  renderMilestones(milestones);

  // History List
  const historyCount = document.getElementById("historyCount");
  if (historyCount) {
    historyCount.textContent = `${state.sessionHistory.length} ${state.sessionHistory.length === 1 ? "Session" : "Sessions"}`;
  }

  const historyList = document.querySelector(".history-list");
  if (historyList) {
    historyList.innerHTML = state.sessionHistory.length
      ? state.sessionHistory
          .map(
            (entry) => `
              <li class="history-item" data-id="${entry.id}">
                <div class="history-left">
                  <span class="session-icon" aria-hidden="true">${entry.mode === "focus" ? "🌿" : entry.mode === "short-break" ? "☕" : "🧘"}</span>
                  <div>
                    <strong class="session-title">${entry.title}</strong>
                    <span class="session-meta">${entry.date === todayStr ? "Today" : entry.date} at ${entry.time} • ${entry.type === "break" ? "Pause" : "Focus session"}</span>
                  </div>
                </div>
                <div class="history-right">
                  <span class="session-duration">${entry.duration} mins</span>
                  <span class="session-badge ${entry.type === "break" ? "break" : "completed"}">${entry.type === "break" ? "Rest" : "Logged"}</span>
                </div>
              </li>
            `,
          )
          .join("")
      : `
        <li class="history-item">
          <div class="history-left">
            <span class="session-icon" aria-hidden="true">✨</span>
            <div>
              <strong class="session-title">Your first session is waiting</strong>
              <span class="session-meta">Start a focus block to begin tracking progress</span>
            </div>
          </div>
          <div class="history-right">
            <span class="session-duration">0 mins</span>
            <span class="session-badge break">Ready</span>
          </div>
        </li>
      `;
  }

  // Phase 5: Weekly Activity Timeline (7-Day Focus Rhythm)
  renderWeeklyTimeline(state.sessionHistory);
}

function renderMilestones(milestones) {
  const mFirst = document.getElementById("milestoneFirst");
  const mFirstStatus = document.getElementById("milestoneFirstStatus");
  if (mFirst) {
    mFirst.setAttribute(
      "data-unlocked",
      milestones.firstStep ? "true" : "false",
    );
  }
  if (mFirstStatus) {
    mFirstStatus.textContent = milestones.firstStep
      ? "Unlocked ✨"
      : "1 session";
  }

  const mGoal = document.getElementById("milestoneGoal");
  const mGoalStatus = document.getElementById("milestoneGoalStatus");
  if (mGoal) {
    mGoal.setAttribute(
      "data-unlocked",
      milestones.dailyGoal ? "true" : "false",
    );
  }
  if (mGoalStatus) {
    mGoalStatus.textContent = milestones.dailyGoal
      ? "Achieved 🎯"
      : `${milestones.todayMinutes}/${DAILY_GOAL_MINUTES}m`;
  }

  const mStreak3 = document.getElementById("milestoneStreak3");
  const mStreak3Status = document.getElementById("milestoneStreak3Status");
  if (mStreak3) {
    mStreak3.setAttribute(
      "data-unlocked",
      milestones.streak3 ? "true" : "false",
    );
  }
  if (mStreak3Status) {
    mStreak3Status.textContent = milestones.streak3
      ? "Active 🌿"
      : `${Math.min(3, milestones.streakCount)}/3 days`;
  }

  const mStreak7 = document.getElementById("milestoneStreak7");
  const mStreak7Status = document.getElementById("milestoneStreak7Status");
  if (mStreak7) {
    mStreak7.setAttribute(
      "data-unlocked",
      milestones.streak7 ? "true" : "false",
    );
  }
  if (mStreak7Status) {
    mStreak7Status.textContent = milestones.streak7
      ? "Rooted 🏆"
      : `${Math.min(7, milestones.streakCount)}/7 days`;
  }

  const summary = document.getElementById("milestonesUnlockedCount");
  if (summary) {
    const totalUnlocked = [
      milestones.firstStep,
      milestones.dailyGoal,
      milestones.streak3,
      milestones.streak7,
    ].filter(Boolean).length;
    summary.textContent = `${totalUnlocked}/4 Unlocked`;
  }
}

function startNotificationPulse() {
  const statusIndicator = document.querySelector(".status-indicator");
  if (statusIndicator) {
    statusIndicator.classList.add("pulse");
  }
}

function stopNotificationPulse() {
  const statusIndicator = document.querySelector(".status-indicator");
  if (statusIndicator) {
    statusIndicator.classList.remove("pulse");
  }
}

function showToast(message, type = "normal") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className =
    `toast ${type === "milestone" ? "toast-milestone" : ""}`.trim();
  toast.setAttribute("role", "status");
  const icon = type === "milestone" ? "🏆" : "🍃";
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 300);
  }, 3500);
}

// -----------------------------------------------------------------------------
// Phase 5: Theme, Audio Alerts, Browser Notifications, Onboarding, and Timeline
// -----------------------------------------------------------------------------

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  const themeIcon = document.getElementById("themeIcon");
  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeIcon) {
    themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  }
  if (themeBtn) {
    themeBtn.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
    );
    themeBtn.title =
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    themeBtn.classList.toggle("is-active", theme === "dark");
  }
}

function toggleTheme() {
  preferences.theme = preferences.theme === "dark" ? "light" : "dark";
  applyTheme(preferences.theme);
  savePreferences();
  showToast(
    preferences.theme === "dark"
      ? "🌙 Calm Dark theme enabled."
      : "☀️ Light theme enabled.",
  );
}

let audioCtx = null;

function playMindfulChime() {
  if (!preferences.soundEnabled) return false;

  try {
    const AudioCtx =
      typeof window !== "undefined"
        ? window.AudioContext || window.webkitAudioContext
        : null;
    if (!AudioCtx) return false;

    if (!audioCtx) {
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch((err) => {
        console.warn("AudioContext resume deferred until user gesture", err);
      });
    }

    const now = audioCtx.currentTime;
    // Harmonic frequencies: 528 Hz (fundamental) & 792 Hz (harmonic 3:2 fifth)
    const tones = [
      { freq: 528, gain: 0.25, duration: 2.8 },
      { freq: 792, gain: 0.12, duration: 2.2 },
    ];

    tones.forEach((tone) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(tone.freq, now);

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(tone.gain, now + 0.08);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + tone.duration);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + tone.duration + 0.1);
    });
    return true;
  } catch (err) {
    console.warn("Audio chime notice:", err);
    return false;
  }
}

function updateSoundButtonUI() {
  const soundBtn = document.getElementById("soundToggleBtn");
  const soundIcon = document.getElementById("soundIcon");
  if (soundIcon) {
    soundIcon.textContent = preferences.soundEnabled ? "🔔" : "🔇";
  }
  if (soundBtn) {
    soundBtn.classList.toggle("is-active", preferences.soundEnabled);
    soundBtn.setAttribute(
      "aria-label",
      preferences.soundEnabled
        ? "Mute chime sound alerts"
        : "Enable chime sound alerts",
    );
    soundBtn.title = preferences.soundEnabled
      ? "Gentle end-of-session chimes enabled (click to mute)"
      : "Enable gentle chimes when a session ends";
  }
}

function toggleSound() {
  preferences.soundEnabled = !preferences.soundEnabled;
  savePreferences();
  updateSoundButtonUI();
  if (preferences.soundEnabled) {
    if (playMindfulChime()) {
      showToast("🔔 Gentle chimes will play when sessions end.");
    } else {
      preferences.soundEnabled = false;
      savePreferences();
      updateSoundButtonUI();
      showToast("Sound alerts are not supported in this browser.");
    }
  } else {
    showToast("🔇 Mindful chime muted.");
  }
}

function updateNotificationButtonUI() {
  const notifBtn = document.getElementById("notifToggleBtn");
  const notifIcon = document.getElementById("notifIcon");
  const isGranted =
    typeof Notification !== "undefined" &&
    Notification.permission === "granted" &&
    preferences.notificationsEnabled;

  if (notifIcon) {
    notifIcon.textContent = isGranted ? "🔔" : "🔕";
  }
  if (notifBtn) {
    notifBtn.classList.toggle("is-active", isGranted);
    notifBtn.setAttribute(
      "aria-label",
      isGranted
        ? "Disable browser notifications"
        : "Enable browser notifications",
    );
    notifBtn.title = isGranted
      ? "Notifications: Enabled (click to disable)"
      : "Notifications: Off (click to enable)";
  }
}

function requestNotificationPermission() {
  if (typeof Notification === "undefined") {
    showToast("Browser notifications are not supported in this browser.");
    return;
  }

  if (Notification.permission === "granted") {
    preferences.notificationsEnabled = !preferences.notificationsEnabled;
    savePreferences();
    updateNotificationButtonUI();
    showToast(
      preferences.notificationsEnabled
        ? "🔔 Browser notifications enabled."
        : "🔕 Browser notifications disabled.",
    );
  } else if (Notification.permission === "denied") {
    preferences.notificationsEnabled = false;
    savePreferences();
    updateNotificationButtonUI();
    showToast("Notifications are blocked in your browser settings.");
  } else {
    showToast("StudyCalm will request permission for session-end reminders.");
    const handleResult = (permission) => {
      if (permission === "granted") {
        preferences.notificationsEnabled = true;
        savePreferences();
        updateNotificationButtonUI();
        showToast("🔔 Notifications enabled for session transitions!");
        sendBrowserNotification(
          "StudyCalm 🌿",
          "Notifications are now active for your focus cycles.",
        );
      } else {
        preferences.notificationsEnabled = false;
        savePreferences();
        updateNotificationButtonUI();
        showToast("Notification permission was not granted.");
      }
    };

    try {
      const p = Notification.requestPermission(handleResult);
      if (p && typeof p.then === "function") {
        p.then(handleResult).catch(() => {});
      }
    } catch (e) {
      console.warn("Notification request permission notice:", e);
    }
  }
}

function sendBrowserNotification(title, body) {
  if (!preferences.notificationsEnabled) return;
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return;

  try {
    new Notification(title, {
      body,
      icon: "🌱",
      silent: true,
    });
  } catch (e) {
    console.warn("Unable to dispatch notification", e);
  }
}

function initHeaderControls() {
  const soundBtn = document.getElementById("soundToggleBtn");
  if (soundBtn && soundBtn.dataset.initialized !== "true") {
    soundBtn.dataset.initialized = "true";
    soundBtn.addEventListener("click", toggleSound);
  }

  const notifBtn = document.getElementById("notifToggleBtn");
  if (notifBtn && notifBtn.dataset.initialized !== "true") {
    notifBtn.dataset.initialized = "true";
    notifBtn.addEventListener("click", requestNotificationPermission);
  }

  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn && themeBtn.dataset.initialized !== "true") {
    themeBtn.dataset.initialized = "true";
    themeBtn.addEventListener("click", toggleTheme);
  }

  applyTheme(preferences.theme);
  updateSoundButtonUI();
  updateNotificationButtonUI();
}

function initOnboarding() {
  const modal = document.getElementById("onboardingModal");
  const dismissBtn = document.getElementById("dismissOnboardingBtn");
  if (!modal || !dismissBtn) return;

  if (modal.dataset.initialized === "true") return;
  modal.dataset.initialized = "true";

  const mainContent = document.getElementById("main-content");
  const focusableSelector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let lastFocusedElement = null;

  const setModalState = (isOpen) => {
    if (isOpen) {
      lastFocusedElement = document.activeElement;
      modal.removeAttribute("hidden");
      if (mainContent) mainContent.setAttribute("inert", "");
      dismissBtn.focus();
    } else {
      modal.setAttribute("hidden", "");
      if (mainContent) mainContent.removeAttribute("inert");
      if (
        lastFocusedElement &&
        typeof lastFocusedElement.focus === "function"
      ) {
        lastFocusedElement.focus();
      }
    }
  };

  const closeModal = () => {
    if (modal.hasAttribute("hidden")) return;
    setModalState(false);
    preferences.onboardingDismissed = true;
    savePreferences();
    showToast("🌿 Welcome! May your study practice bring clarity and calm.");
  };

  if (!preferences.onboardingDismissed) {
    setModalState(true);
  }

  dismissBtn.addEventListener("click", closeModal);

  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hasAttribute("hidden")) {
      closeModal();
      return;
    }

    if (e.key !== "Tab" || modal.hasAttribute("hidden")) return;

    const focusableElements = Array.from(
      modal.querySelectorAll(focusableSelector),
    );
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  });
}

function renderWeeklyTimeline(sessionHistory) {
  const container = document.getElementById("timelineBars");
  if (!container) return;

  const { days, weekTotal, activeDays, dailyAvg } =
    getWeeklyTimelineData(sessionHistory);

  const maxMinutes = Math.max(120, ...days.map((d) => d.minutes));

  // Update summary stats
  const badgeEl = document.getElementById("timelineSummaryBadge");
  if (badgeEl) badgeEl.textContent = `${weekTotal} mins this week`;

  const totalEl = document.getElementById("timelineWeekTotal");
  if (totalEl) totalEl.textContent = `${weekTotal} mins`;

  const activeEl = document.getElementById("timelineActiveDays");
  if (activeEl) activeEl.textContent = `${activeDays} / 7 days`;

  const avgEl = document.getElementById("timelineDailyAvg");
  if (avgEl) avgEl.textContent = `${dailyAvg} mins/day`;

  // Render 7-day columns
  container.innerHTML = days
    .map((day) => {
      const fillPct =
        day.minutes > 0
          ? Math.max(
              8,
              Math.min(100, Math.round((day.minutes / maxMinutes) * 100)),
            )
          : 0;
      const todayClass = day.isToday ? "is-today" : "";
      const valLabel = day.minutes > 0 ? `${day.minutes}m` : "0m";

      return `
      <div class="timeline-bar-column ${todayClass}" title="${day.dateStr}: ${day.minutes} focus minutes">
        <span class="timeline-bar-val">${valLabel}</span>
        <div class="timeline-bar-rail">
          <div class="timeline-bar-fill" style="height: ${fillPct}%"></div>
        </div>
        <span class="timeline-bar-day">${day.dayLabel}</span>
      </div>
    `.trim();
    })
    .join("");
}

// -----------------------------------------------------------------------------
// Module Exports for Testing
// -----------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MODE_CONFIG,
    DAILY_GOAL_MINUTES,
    PREFERENCES_KEY,
    parseDuration,
    formatDuration,
    calculateProgress,
    getLocalDateString,
    getYesterdayDateString,
    getTodayFocusMinutes,
    getTotalFocusSessions,
    calculateStreak,
    getMilestones,
    getWeeklyTimelineData,
    deduplicateHistory,
    createDefaultState,
    createDefaultPreferences,
    FEEDBACK_KEY,
    FEEDBACK_FEELINGS,
    createFeedbackEntry,
  };
}
