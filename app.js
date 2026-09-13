"use strict";

const STORAGE_KEY = "studycalm-state-v4";
const PREV_STORAGE_KEY_V3 = "studycalm-state-v3";
const LEGACY_STORAGE_KEY = "studycalm-state-v1";
const PREFERENCES_KEY = "studycalm-preferences-v1";
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

function normalizePreferenceNumber(value, fallback, min, max) {
  return Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value)
    : fallback;
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

function getFocusDurationMinutes() {
  const value = Number(preferences?.focusDurationMinutes);
  return Number.isFinite(value) && value >= 1 && value <= 180
    ? Math.round(value)
    : 25;
}

function getModeDuration(modeKey) {
  if (modeKey === "focus") return getFocusDurationMinutes() * 60;
  if (modeKey === "short-break") return preferences.shortBreakMinutes * 60;
  return preferences.longBreakMinutes * 60;
}

function getPomodoroCycleState(sessionHistory) {
  const completedFocusSessions = getTotalFocusSessions(sessionHistory);
  const cycleLength = preferences.cycleLength || 4;
  const completedInCycle = completedFocusSessions % cycleLength;

  return {
    completedFocusSessions,
    currentNumber: completedInCycle + 1,
    cycleLength,
    nextBreakMode:
      completedFocusSessions > 0 && completedInCycle === 0
        ? "long-break"
        : "short-break",
  };
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((task) => task && typeof task.title === "string")
    .slice(0, 50)
    .map((task) => ({
      id: typeof task.id === "string" ? task.id : `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: task.title.trim().slice(0, 80),
      estimate: Math.min(20, Math.max(1, Number(task.estimate) || 1)),
      completed: Math.max(0, Number(task.completed) || 0),
      done: Boolean(task.done),
    }))
    .filter((task) => task.title);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    tasks: [],
    activeTaskId: null,
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
    focusDurationMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    cycleLength: 4,
    autoStartNext: false,
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
      focusDurationMinutes:
        Number.isFinite(parsed.focusDurationMinutes) &&
        parsed.focusDurationMinutes >= 1 &&
        parsed.focusDurationMinutes <= 180
          ? Math.round(parsed.focusDurationMinutes)
          : 25,
      shortBreakMinutes: normalizePreferenceNumber(parsed.shortBreakMinutes, 5, 1, 30),
      longBreakMinutes: normalizePreferenceNumber(parsed.longBreakMinutes, 15, 1, 60),
      cycleLength: normalizePreferenceNumber(parsed.cycleLength, 4, 1, 8),
      autoStartNext: Boolean(parsed.autoStartNext),
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
    initKeyboardShortcuts();
    initFocusDurationControl();
    initTaskControls();
    initSessionCompletedControls();
    initHeaderControls();
    initFocusMode();
    initProgressiveWebApp();
    initOnboarding();
    initDataTransferControls();
    render();
    console.log("🌿 StudyCalm SSOT state engine initialized successfully.");
  });
}

function initProgressiveWebApp() {
  if (typeof window === "undefined") return;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => {
        console.warn("StudyCalm offline mode could not be enabled:", error);
      });
    }, { once: true });
  }

  const installButton = document.getElementById("installAppBtn");
  if (!installButton) return;

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installButton.hidden = false;
  }, { once: true });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      showToast("StudyCalm was added to your device.");
    }
    deferredPrompt = null;
    installButton.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installButton.hidden = true;
    showToast("StudyCalm is ready whenever you are.");
  }, { once: true });
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
    const modeDuration = getModeDuration(selectedMode);

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
      tasks: normalizeTasks(parsed.tasks),
      activeTaskId:
        typeof parsed.activeTaskId === "string" ? parsed.activeTaskId : null,
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
        tasks: state.tasks,
        activeTaskId: state.activeTaskId,
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
      tasks: state.tasks,
      activeTaskId: state.activeTaskId,
      acknowledgedMilestones: state.acknowledgedMilestones,
      sessionHistory: state.sessionHistory,
      lastUpdatedAt: state.lastUpdatedAt,
    },
    preferences: {
      theme: preferences.theme,
      soundEnabled: preferences.soundEnabled,
      notificationsEnabled: preferences.notificationsEnabled,
      onboardingDismissed: preferences.onboardingDismissed,
      focusDurationMinutes: preferences.focusDurationMinutes,
    },
  };
}

function validateBackupPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const importedState =
    payload.state && typeof payload.state === "object" ? payload.state : payload;

  return (
    importedState &&
    typeof importedState === "object" &&
    Array.isArray(importedState.sessionHistory)
  );
}

function normalizeImportedState(payload) {
  if (!validateBackupPayload(payload)) {
    throw new Error("Backup must contain a JSON object with valid session history.");
  }

  const importedState =
    payload.state && typeof payload.state === "object"
      ? payload.state
      : payload;

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
        : getModeDuration(selectedMode),
    isRunning: false,
    targetEndTime: null,
    activeSessionId: null,
    tasks: normalizeTasks(importedState.tasks),
    activeTaskId:
      typeof importedState.activeTaskId === "string"
        ? importedState.activeTaskId
        : null,
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
    focusDurationMinutes:
      Number.isFinite(importedPreferences.focusDurationMinutes) &&
      importedPreferences.focusDurationMinutes >= 1 &&
      importedPreferences.focusDurationMinutes <= 180
        ? Math.round(importedPreferences.focusDurationMinutes)
        : 25,
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
  if (!file || typeof file.text !== "function") {
    showToast("That backup file is invalid or could not be read.");
    return;
  }

  try {
    const payload = JSON.parse(await file.text());

    if (!validateBackupPayload(payload)) {
      throw new Error("Backup is missing valid state data.");
    }

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
      state.remainingSeconds = getModeDuration(state.selectedMode);
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

function initFocusDurationControl() {
  const input = document.getElementById("focusDurationInput");
  const applyBtn = document.getElementById("applyFocusDurationBtn");
  if (!input || !applyBtn || applyBtn.dataset.initialized === "true") return;

  applyBtn.dataset.initialized = "true";
  input.value = String(getFocusDurationMinutes());

  applyBtn.addEventListener("click", () => {
    const minutes = Number(input.value);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
      showToast("Choose a focus interval between 1 and 180 minutes.");
      input.focus();
      return;
    }

    preferences.focusDurationMinutes = Math.round(minutes);
    savePreferences();

    if (state.selectedMode === "focus" && !state.isRunning) {
      state.remainingSeconds = getModeDuration("focus");
      state.targetEndTime = null;
      state.activeSessionId = null;
      saveState();
    }

    render();
    showToast(`Focus interval set to ${preferences.focusDurationMinutes} minutes.`);
  });
}

function initTaskControls() {
  const form = document.getElementById("taskForm");
  const titleInput = document.getElementById("taskTitleInput");
  const estimateInput = document.getElementById("taskEstimateInput");
  if (!form || !titleInput || !estimateInput || form.dataset.initialized === "true") {
    return;
  }

  form.dataset.initialized = "true";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    const estimate = Math.min(20, Math.max(1, Number(estimateInput.value) || 1));
    if (!title) return;

    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: title.slice(0, 80),
      estimate,
      completed: 0,
      done: false,
    };
    state.tasks.unshift(task);
    if (!state.activeTaskId) state.activeTaskId = task.id;
    saveState();
    render();
    titleInput.value = "";
    estimateInput.value = "1";
    titleInput.focus();
    showToast(`Task added: ${task.title}`);
  });

  document.getElementById("taskList")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-task-action]");
    if (!button) return;
    const taskId = button.closest("[data-task-id]")?.dataset.taskId;
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;

    if (button.dataset.taskAction === "move-up" || button.dataset.taskAction === "move-down") {
      const index = state.tasks.findIndex((item) => item.id === task.id);
      const offset = button.dataset.taskAction === "move-up" ? -1 : 1;
      const targetIndex = index + offset;
      if (targetIndex >= 0 && targetIndex < state.tasks.length) {
        [state.tasks[index], state.tasks[targetIndex]] = [
          state.tasks[targetIndex],
          state.tasks[index],
        ];
        saveState();
        render();
      }
    } else if (button.dataset.taskAction === "edit") {
      const title = window.prompt("Update task name", task.title);
      if (title === null) return;
      const nextTitle = title.trim().slice(0, 80);
      if (!nextTitle) {
        showToast("Task name cannot be empty.");
        return;
      }
      const estimate = window.prompt("Estimated Pomodoros (1–20)", String(task.estimate));
      if (estimate === null) return;
      const nextEstimate = Number(estimate);
      if (!Number.isInteger(nextEstimate) || nextEstimate < 1 || nextEstimate > 20) {
        showToast("Choose an estimate from 1 to 20 Pomodoros.");
        return;
      }
      task.title = nextTitle;
      task.estimate = Math.max(task.completed, nextEstimate);
      task.done = task.completed >= task.estimate;
      saveState();
      render();
    } else if (button.dataset.taskAction === "select") {
      state.activeTaskId = task.id;
      saveState();
      render();
      showToast(`Next Pomodoro: ${task.title}`);
    } else if (button.dataset.taskAction === "complete") {
      task.done = !task.done;
      if (task.done && state.activeTaskId === task.id) state.activeTaskId = null;
      saveState();
      render();
    } else if (button.dataset.taskAction === "delete") {
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      if (state.activeTaskId === task.id) state.activeTaskId = state.tasks[0]?.id || null;
      saveState();
      render();
    }
  });
}

function renderTasks() {
  const list = document.getElementById("taskList");
  const count = document.getElementById("taskCount");
  if (!list) return;
  const activeTasks = state.tasks.filter((task) => !task.done);
  if (count) count.textContent = `${activeTasks.length} active`;

  list.innerHTML = state.tasks.length
    ? state.tasks.map((task) => {
        const active = task.id === state.activeTaskId;
        const progress = `${Math.min(task.completed, task.estimate)}/${task.estimate}`;
        const safeTitle = escapeHtml(task.title);
        const safeId = escapeHtml(task.id);
        return `<li class="task-item ${task.done ? "is-done" : ""} ${active ? "is-active" : ""}" data-task-id="${safeId}">
          <button type="button" class="task-select" data-task-action="select" ${task.done ? "disabled" : ""}>
            <span class="task-check" aria-hidden="true">${task.done ? "✓" : active ? "●" : "○"}</span>
            <span class="task-copy"><strong>${safeTitle}</strong><small>${progress} Pomodoros</small><span class="task-progress"><span style="width:${Math.min(100, Math.round((task.completed / task.estimate) * 100))}%"></span></span></span>
          </button>
          <div class="task-actions">
            <button type="button" class="icon-btn" data-task-action="move-up" aria-label="Move ${safeTitle} up" ${state.tasks[0]?.id === task.id ? "disabled" : ""}>↑</button>
            <button type="button" class="icon-btn" data-task-action="move-down" aria-label="Move ${safeTitle} down" ${state.tasks[state.tasks.length - 1]?.id === task.id ? "disabled" : ""}>↓</button>
            <button type="button" class="icon-btn" data-task-action="edit" aria-label="Edit ${safeTitle}">✎</button>
            <button type="button" class="icon-btn" data-task-action="complete" aria-label="${task.done ? "Reopen" : "Complete"} ${safeTitle}">${task.done ? "↶" : "✓"}</button>
            <button type="button" class="icon-btn" data-task-action="delete" aria-label="Delete ${safeTitle}">×</button>
          </div>
        </li>`;
      }).join("")
    : '<li class="task-empty">Add a task to give your next Pomodoro a clear intention.</li>';
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

function initKeyboardShortcuts() {
  if (document.body.dataset.shortcutsInitialized === "true") return;
  document.body.dataset.shortcutsInitialized = "true";

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "escape" && document.getElementById("focusModeOverlay")?.hidden === false) {
      closeFocusMode();
      return;
    }
    if (key === " " || key === "spacebar") {
      event.preventDefault();
      document.getElementById("startTimerBtn")?.click();
    } else if (key === "r") {
      event.preventDefault();
      document.getElementById("resetTimerBtn")?.click();
    } else if (key === "1") {
      selectMode("focus");
    } else if (key === "2") {
      selectMode("short-break");
    } else if (key === "3") {
      selectMode("long-break");
    }

  });
}

function initFocusMode() {
  const openButton = document.getElementById("focusModeBtn");
  const overlay = document.getElementById("focusModeOverlay");
  const closeButton = document.getElementById("closeFocusModeBtn");
  const startButton = document.getElementById("focusModeStartBtn");
  const resetButton = document.getElementById("focusModeResetBtn");
  const mainContent = document.getElementById("main-content");
  const focusableSelector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  if (!openButton || !overlay || openButton.dataset.initialized === "true") return;

  openButton.dataset.initialized = "true";
  openButton.addEventListener("click", openFocusMode);
  closeButton?.addEventListener("click", closeFocusMode);
  startButton?.addEventListener("click", () => {
    document.getElementById("startTimerBtn")?.click();
    updateFocusMode();
  });
  resetButton?.addEventListener("click", () => {
    document.getElementById("resetTimerBtn")?.click();
    updateFocusMode();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeFocusMode();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...overlay.querySelectorAll(focusableSelector)];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFocusMode();
    }
  });

}

function openFocusMode() {
  const overlay = document.getElementById("focusModeOverlay");
  if (!overlay) return;
  const mainContent = document.getElementById("main-content");
  overlay.hidden = false;
  document.body.classList.add("focus-mode-open");
  if (mainContent) mainContent.setAttribute("inert", "");
  updateFocusMode();
  document.getElementById("focusModeStartBtn")?.focus();
}

function closeFocusMode() {
  const overlay = document.getElementById("focusModeOverlay");
  if (!overlay) return;
  const mainContent = document.getElementById("main-content");
  overlay.hidden = true;
  document.body.classList.remove("focus-mode-open");
  if (mainContent) mainContent.removeAttribute("inert");
  document.getElementById("focusModeBtn")?.focus();
}

function updateFocusMode() {
  const label = document.getElementById("focusModeLabel");
  const time = document.getElementById("focusModeTime");
  const task = document.getElementById("focusModeTask");
  const startButton = document.getElementById("focusModeStartBtn");
  if (label) label.textContent = MODE_CONFIG[state.selectedMode]?.label || "Focus Mode";
  if (time) time.textContent = formatDuration(state.remainingSeconds);
  if (task) {
    const activeTask = state.tasks.find((item) => item.id === state.activeTaskId && !item.done);
    task.textContent = activeTask?.title || "Ready for your next focus block.";
  }
  if (startButton) {
    startButton.textContent = state.isRunning ? "Pause Session" : "Start Session";
  }
}

function initSessionCompletedControls() {
  const breakBtn = document.getElementById("completedTakeBreakBtn");
  const nextFocusBtn = document.getElementById("completedNextFocusBtn");

  if (breakBtn) {
    breakBtn.addEventListener("click", () => {
      hideSessionCompletedPanel();
      selectMode(getPomodoroCycleState(state.sessionHistory).nextBreakMode);
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
  state.remainingSeconds = getModeDuration(modeKey);
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
        ? `${Math.round(getModeDuration("focus") / 60)} minutes of mindful focus recorded to your daily horizon.`
        : "Rest and reset complete. Ready to return with fresh focus.";
  }

  const breakButton = document.getElementById("completedTakeBreakBtn");
  if (breakButton && modeConfig.type === "focus") {
    const nextBreakMode = getPomodoroCycleState(state.sessionHistory).nextBreakMode;
    const nextBreak = MODE_CONFIG[nextBreakMode];
    breakButton.innerHTML = `<span class="btn-icon" aria-hidden="true">${nextBreak.icon}</span><span>Take a ${Math.round(nextBreak.duration / 60)}m ${nextBreakMode === "long-break" ? "Reset" : "Pause"}</span>`;
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
    state.remainingSeconds = getModeDuration(state.selectedMode);
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
      if (tickCount % (preferences.cycleLength || 4) === 0) {
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
  state.remainingSeconds = getModeDuration(state.selectedMode);
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
    const durationSeconds = getModeDuration(currentMode);
    const durationMinutes = Math.round(durationSeconds / 60);
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

      if (modeConfig.type === "focus" && state.activeTaskId) {
        const activeTask = state.tasks.find(
          (task) => task.id === state.activeTaskId,
        );
        if (activeTask) {
          activeTask.completed += 1;
          if (activeTask.completed >= activeTask.estimate) {
            activeTask.done = true;
            state.activeTaskId =
              state.tasks.find((task) => !task.done)?.id || null;
          }
        }
      }
    }

    state.activeSessionId = null;
    state.remainingSeconds = durationSeconds;
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
      const nextMode =
        modeConfig.type === "focus"
          ? getPomodoroCycleState(state.sessionHistory).nextBreakMode
          : "focus";
      if (preferences.autoStartNext) {
        selectMode(nextMode);
        resumeTimer();
      } else {
        showSessionCompletedPanel(modeConfig);
      }

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
  updateFocusMode();

  const ringProgress = document.querySelector(".ring-progress");
  if (ringProgress) {
    const circleRadius = 96;
    const circumference = 2 * Math.PI * circleRadius;
    const totalDuration = getModeDuration(state.selectedMode);
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
    const activeTask = state.tasks.find((task) => task.id === state.activeTaskId);
    timerIntention.textContent = activeTask
      ? `Focus: ${activeTask.title}`
      : `Focus: ${MODE_CONFIG[state.selectedMode].intention}`;
  }

  const currentModeLabel = document.getElementById("currentModeLabel");
  if (currentModeLabel) {
    currentModeLabel.textContent = MODE_CONFIG[state.selectedMode].label;
  }

  document.querySelectorAll(".mode-btn").forEach((button) => {
    const modeKey = button.dataset.mode;
    if (!MODE_CONFIG[modeKey]) return;
    const minutes = Math.round(getModeDuration(modeKey) / 60);
    const label =
      modeKey === "focus"
        ? `Deep Focus (${minutes}m)`
        : modeKey === "short-break"
          ? `Short Pause (${minutes}m)`
          : `Restful Reset (${minutes}m)`;
    button.textContent = label;
  });

  const pomodoroCount = document.getElementById("pomodoroCount");
  if (pomodoroCount) {
    const cycle = getPomodoroCycleState(state.sessionHistory);
    pomodoroCount.textContent = `Pomodoro ${cycle.currentNumber} of ${cycle.cycleLength}`;
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
    progressBar.setAttribute(
      "aria-valuenow",
      String(Math.min(DAILY_GOAL_MINUTES, todayMinutes)),
    );
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
      state.remainingSeconds < getModeDuration(state.selectedMode);
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
  renderTasks();

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

  const settingsBtn = document.getElementById("settingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const mainContent = document.getElementById("main-content");
  const focusableSelector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let settingsReturnFocus = null;
  const closeSettings = () => {
    if (!settingsModal || settingsModal.hidden) return;
    settingsModal.hidden = true;
    if (mainContent) mainContent.removeAttribute("inert");
    settingsReturnFocus?.focus();
  };
  const openSettings = () => {
    if (!settingsModal) return;
    settingsReturnFocus = document.activeElement;
    document.getElementById("settingsFocusMinutes").value = preferences.focusDurationMinutes;
    document.getElementById("settingsShortBreak").value = preferences.shortBreakMinutes;
    document.getElementById("settingsLongBreak").value = preferences.longBreakMinutes;
    document.getElementById("settingsCycleLength").value = preferences.cycleLength;
    document.getElementById("settingsAutoStart").checked = preferences.autoStartNext;
    settingsModal.hidden = false;
    if (mainContent) mainContent.setAttribute("inert", "");
    document.getElementById("settingsFocusMinutes").focus();
  };
  if (settingsBtn && settingsBtn.dataset.initialized !== "true") {
    settingsBtn.dataset.initialized = "true";
    settingsBtn.addEventListener("click", openSettings);
    const presets = {
      classic: [25, 5, 15, 4],
      deep: [50, 10, 20, 4],
      sprint: [90, 15, 30, 3],
    };
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        const values = presets[button.dataset.preset];
        if (!values) return;
        document.getElementById("settingsFocusMinutes").value = values[0];
        document.getElementById("settingsShortBreak").value = values[1];
        document.getElementById("settingsLongBreak").value = values[2];
        document.getElementById("settingsCycleLength").value = values[3];
        document.querySelectorAll("[data-preset]").forEach((item) => {
          item.classList.toggle("is-selected", item === button);
        });
      });
    });
    document.getElementById("closeSettingsBtn")?.addEventListener("click", closeSettings);
    document.getElementById("cancelSettingsBtn")?.addEventListener("click", closeSettings);
    document.getElementById("saveSettingsBtn")?.addEventListener("click", () => {
      preferences.focusDurationMinutes = normalizePreferenceNumber(
        Number(document.getElementById("settingsFocusMinutes").value), 25, 1, 180,
      );
      preferences.shortBreakMinutes = normalizePreferenceNumber(
        Number(document.getElementById("settingsShortBreak").value), 5, 1, 30,
      );
      preferences.longBreakMinutes = normalizePreferenceNumber(
        Number(document.getElementById("settingsLongBreak").value), 15, 1, 60,
      );
      preferences.cycleLength = normalizePreferenceNumber(
        Number(document.getElementById("settingsCycleLength").value), 4, 1, 8,
      );
      preferences.autoStartNext = document.getElementById("settingsAutoStart").checked;
      savePreferences();
      if (!state.isRunning) {
        state.remainingSeconds = getModeDuration(state.selectedMode);
        persistState();
      }
      render();
      closeSettings();
      showToast("Timer settings saved.");
    });
    settingsModal?.addEventListener("click", (event) => {
      if (event.target === settingsModal) closeSettings();
    });
    settingsModal?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSettings();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...settingsModal.querySelectorAll(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
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

  renderFocusInsights({ days, activeDays }, sessionHistory);
}

function renderFocusInsights(weeklyData, sessionHistory) {
  const weekDates = new Set(weeklyData.days.map((day) => day.dateStr));
  const weekEntries = (Array.isArray(sessionHistory) ? sessionHistory : [])
    .filter((entry) => entry.type === "focus" && weekDates.has(entry.date));
  const sessions = weekEntries.length;
  const average = sessions
    ? Math.round(weekEntries.reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0) / sessions)
    : 0;
  const bestDay = weeklyData.days.reduce(
    (best, day) => (day.minutes > best.minutes ? day : best),
    { dayLabel: "—", minutes: 0 },
  );
  const values = {
    insightsSessions: String(sessions),
    insightsAverage: `${average}m`,
    insightsBestDay: bestDay.minutes ? `${bestDay.dayLabel} · ${bestDay.minutes}m` : "—",
    insightsConsistency: `${Math.round((weeklyData.activeDays / 7) * 100)}%`,
  };

  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });

  const message = document.getElementById("insightsMessage");
  if (message) {
    message.textContent =
      sessions === 0
        ? "Complete a focus block to start building your weekly rhythm."
        : weeklyData.activeDays >= 5
          ? "Your rhythm is steady this week. Protect the habit with a calm finish."
          : `${weeklyData.activeDays} active ${weeklyData.activeDays === 1 ? "day" : "days"} so far. A short focus block today keeps the rhythm moving.`;
  }
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
    getFocusDurationMinutes,
    getModeDuration,
    createExportPayload,
    validateBackupPayload,
    normalizeImportedState,
    normalizeImportedPreferences,
    exportStudyData,
    importStudyData,
  };
}
