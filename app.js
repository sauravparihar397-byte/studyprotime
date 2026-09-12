"use strict";

const STORAGE_KEY = "studycalm-state-v4";
const PREV_STORAGE_KEY_V3 = "studycalm-state-v3";
const LEGACY_STORAGE_KEY = "studycalm-state-v1";
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

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getYesterdayDateString(today = new Date()) {
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return getLocalDateString(yesterday);
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
 * Deterministic streak calculator computed directly from session history dates.
 * Returns { count, status, lastStudyDate }
 * status: 'active' (studied today), 'waiting' (studied yesterday, waiting for today), 'inactive' (streak broken)
 */
function calculateStreak(sessionHistory, today = new Date()) {
  if (!Array.isArray(sessionHistory) || sessionHistory.length === 0) {
    return { count: 0, status: "inactive", lastStudyDate: null };
  }

  const focusSessions = sessionHistory.filter((s) => s.type === "focus");
  if (focusSessions.length === 0) {
    return { count: 0, status: "inactive", lastStudyDate: null };
  }

  // Set of unique study calendar dates
  const studyDatesSet = new Set(focusSessions.map((s) => s.date));
  const todayStr = getLocalDateString(today);
  const yesterdayStr = getYesterdayDateString(today);

  // Find most recent study date
  const sortedDates = Array.from(studyDatesSet).sort().reverse();
  const mostRecentDate = sortedDates[0];

  let anchorDate;
  let status;

  if (studyDatesSet.has(todayStr)) {
    anchorDate = new Date(today);
    status = "active";
  } else if (studyDatesSet.has(yesterdayStr)) {
    anchorDate = new Date(today);
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
 * Check which milestones are unlocked based on SSOT data
 */
function checkMilestoneUnlocks(todayMinutes, totalSessions, streakCount) {
  return {
    firstStep: totalSessions >= 1,
    dailyGoal: todayMinutes >= DAILY_GOAL_MINUTES,
    streak3: streakCount >= 3,
    streak7: streakCount >= 7,
  };
}

// -----------------------------------------------------------------------------
// State Management & Migration
// -----------------------------------------------------------------------------

function createDefaultState() {
  const today = getLocalDateString();
  return {
    version: 4,
    selectedMode: "focus",
    remainingSeconds: MODE_CONFIG.focus.duration,
    isRunning: false,
    targetEndTime: null,
    currentDate: today,
    todayFocusMinutes: 0,
    totalFocusSessions: 0,
    streak: {
      count: 0,
      lastStudyDate: null,
    },
    achievements: {
      firstStep: null,
      dailyGoal: null,
      streak3: null,
      streak7: null,
    },
    milestonesReached: {
      halfway: false,
      completed: false,
    },
    sessionHistory: [],
    lastUpdatedAt: Date.now(),
  };
}

let state = createDefaultState();
let timerIntervalId = null;
let isCompletingCycle = false;
let sessionCompletedPending = false;

window.addEventListener("DOMContentLoaded", () => {
  restoreState();
  initNavigation();
  initModeSelector();
  initTimerControls();
  initSessionCompletedControls();
  render();
  console.log("🌿 StudyCalm Phase 4 Tracking Integrity & Achievements active.");
});

function loadState() {
  const today = getLocalDateString();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const previousRaw = localStorage.getItem(PREV_STORAGE_KEY_V3);
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);

    if (!raw && !previousRaw && !legacyRaw) {
      return createDefaultState();
    }

    const parsed = raw
      ? JSON.parse(raw)
      : previousRaw
        ? JSON.parse(previousRaw)
        : JSON.parse(legacyRaw);

    const selectedMode = MODE_CONFIG[parsed.selectedMode]
      ? parsed.selectedMode
      : "focus";
    const modeDuration = MODE_CONFIG[selectedMode].duration;

    const rawHistory = Array.isArray(parsed.sessionHistory)
      ? parsed.sessionHistory
      : [];

    const validHistory = rawHistory
      .filter(
        (entry) =>
          entry && typeof entry.date === "string" && Number(entry.duration) > 0,
      )
      .map((entry, index) => ({
        id: entry.id || `sess_${Date.now()}_${index}`,
        mode: entry.mode || "focus",
        title: entry.title || "Deep Focus",
        duration: Number(entry.duration) || 25,
        time: entry.time || "Earlier",
        date: entry.date,
        type: entry.type || (entry.mode === "focus" ? "focus" : "break"),
        completedAt: Number(entry.completedAt) || Date.now(),
      }));

    const dedupedHistory = [];
    const seenIds = new Set();
    for (const entry of validHistory) {
      const duplicateKey = `${entry.date}-${entry.type}-${entry.duration}-${entry.time}`;
      if (!seenIds.has(duplicateKey)) {
        seenIds.add(duplicateKey);
        dedupedHistory.push(entry);
      }
    }

    const savedStreak =
      parsed.streak && typeof parsed.streak === "object"
        ? parsed.streak
        : { count: 0, lastStudyDate: null };

    const streak = {
      count:
        Number.isInteger(savedStreak.count) && savedStreak.count >= 0
          ? savedStreak.count
          : calculateStreak(dedupedHistory).count,
      lastStudyDate:
        typeof savedStreak.lastStudyDate === "string"
          ? savedStreak.lastStudyDate
          : calculateStreak(dedupedHistory).lastStudyDate,
    };

    const historyTodayMinutes = getTodayFocusMinutes(dedupedHistory, today);

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
      currentDate: today,
      todayFocusMinutes:
        typeof parsed.currentDate === "string" && parsed.currentDate === today
          ? historyTodayMinutes
          : 0,
      totalFocusSessions: getTotalFocusSessions(dedupedHistory),
      streak,
      achievements: {
        firstStep: parsed.achievements?.firstStep || null,
        dailyGoal: parsed.achievements?.dailyGoal || null,
        streak3: parsed.achievements?.streak3 || null,
        streak7: parsed.achievements?.streak7 || null,
      },
      milestonesReached: {
        halfway: Boolean(parsed.milestonesReached?.halfway),
        completed: Boolean(parsed.milestonesReached?.completed),
      },
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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, lastUpdatedAt: Date.now() }),
    );
  } catch (error) {
    console.warn("Unable to save study state", error);
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
}

// -----------------------------------------------------------------------------
// UI Initializers & Event Handlers
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
        ? `${Math.round(modeConfig.duration / 60)} minutes of steady focus recorded to your daily horizon.`
        : "Rest and reset complete. Ready to return with clear focus.";
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
  state.remainingSeconds = MODE_CONFIG[state.selectedMode].duration;
  state.lastUpdatedAt = Date.now();

  stopNotificationPulse();
  hideSessionCompletedPanel();
  saveState();
  render();
  showToast("Timer reset to the start of this interval.");
}

// -----------------------------------------------------------------------------
// Cycle Completion & Anti-Duplicate Validation
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

    state.currentDate = today;

    // Generate unique session ID
    const sessionId = `sess_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;
    const timeDisplay = now.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });

    // Anti-duplicate validation: check if identical session logged within 15 seconds
    const isDuplicate = state.sessionHistory.some(
      (entry) =>
        entry.date === today &&
        entry.type === modeConfig.type &&
        Math.abs((entry.completedAt || 0) - now.getTime()) < 15000,
    );

    if (!isDuplicate) {
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

      // Keep recent 30 entries
      state.sessionHistory = state.sessionHistory.slice(0, 30);
    }

    // Reset timer display to mode duration
    state.remainingSeconds = modeConfig.duration;
    state.lastUpdatedAt = Date.now();

    // Check & trigger achievements
    evaluateAchievements(fromReload);

    saveState();
    render();

    if (!fromReload) {
      showSessionCompletedPanel(modeConfig);
      if (modeConfig.type === "focus") {
        showToast(
          "🌿 Focus block complete. Time for a peaceful pause.",
          "milestone",
        );
      } else {
        showToast(
          `☕ ${modeConfig.label} complete. Ready to return with fresh focus.`,
        );
      }
    }
  } finally {
    isCompletingCycle = false;
  }
}

function evaluateAchievements(silent = false) {
  const todayMinutes = getTodayFocusMinutes(state.sessionHistory);
  const totalSessions = getTotalFocusSessions(state.sessionHistory);
  const streakData = calculateStreak(state.sessionHistory);
  const unlocks = checkMilestoneUnlocks(
    todayMinutes,
    totalSessions,
    streakData.count,
  );

  const now = Date.now();

  if (unlocks.firstStep && !state.achievements.firstStep) {
    state.achievements.firstStep = now;
    if (!silent) {
      showToast(
        "🌱 Achievement Unlocked: First Step — Showing up matters.",
        "milestone",
      );
    }
  }

  if (unlocks.dailyGoal && !state.achievements.dailyGoal) {
    state.achievements.dailyGoal = now;
    if (!silent) {
      showToast(
        "🎯 Achievement Unlocked: Daily Horizon Fulfilled (120 mins)!",
        "milestone",
      );
    }
  }

  if (unlocks.streak3 && !state.achievements.streak3) {
    state.achievements.streak3 = now;
    if (!silent) {
      showToast(
        "🌿 Achievement Unlocked: 3-Day Rhythm — Consistency taking root.",
        "milestone",
      );
    }
  }

  if (unlocks.streak7 && !state.achievements.streak7) {
    state.achievements.streak7 = now;
    if (!silent) {
      showToast(
        "🏆 Achievement Unlocked: 7-Day Rooted — Deep focus habit.",
        "milestone",
      );
    }
  }
}

// -----------------------------------------------------------------------------
// DOM Rendering & Microcopy
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

  // SSOT Computed Metrics
  const todayMinutes = getTodayFocusMinutes(state.sessionHistory);
  const totalFocusSessions = getTotalFocusSessions(state.sessionHistory);
  const streakData = calculateStreak(state.sessionHistory);
  const progressPercent = calculateProgress(todayMinutes, DAILY_GOAL_MINUTES);

  // Timer card text
  const timerIntention = document.getElementById("timerIntention");
  if (timerIntention) {
    timerIntention.textContent = `Focus: ${MODE_CONFIG[state.selectedMode].intention}`;
  }

  const currentModeLabel = document.getElementById("currentModeLabel");
  if (currentModeLabel) {
    currentModeLabel.textContent = MODE_CONFIG[state.selectedMode].label;
  }

  // Summary Metrics Strip (Phase 4)
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
    summaryStreakCount.textContent = `${streakData.count} ${streakData.count === 1 ? "Day" : "Days"}`;
  }

  const summaryStreakSub = document.getElementById("summaryStreakSub");
  if (summaryStreakSub) {
    summaryStreakSub.textContent =
      streakData.status === "active"
        ? "Logged Today ✨"
        : streakData.status === "waiting"
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

  // Goal card updates
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
    if (streakData.status === "active") {
      streakDisplay.textContent = `${streakData.count} ${streakData.count === 1 ? "day" : "days"} of calm dedication (Logged today)`;
    } else if (streakData.status === "waiting") {
      streakDisplay.textContent = `${streakData.count} ${streakData.count === 1 ? "day" : "days"} streak • Log a session today to continue`;
    } else {
      streakDisplay.textContent = "0 days • Start your first focus block today";
    }
  }

  const streakPill = document.getElementById("streakPill");
  if (streakPill) {
    streakPill.textContent =
      streakData.status === "active"
        ? "Logged Today"
        : streakData.status === "waiting"
          ? "Active Streak"
          : "Ready";
  }

  // Timer controls & action labels
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
  renderMilestones(todayMinutes, totalFocusSessions, streakData.count);

  // History List
  const historyCount = document.getElementById("historyCount");
  if (historyCount) {
    historyCount.textContent = `${state.sessionHistory.length} ${state.sessionHistory.length === 1 ? "Session" : "Sessions"}`;
  }

  const todayStr = getLocalDateString();
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
}

function renderMilestones(todayMinutes, totalSessions, streakCount) {
  const unlocks = checkMilestoneUnlocks(
    todayMinutes,
    totalSessions,
    streakCount,
  );

  const mFirst = document.getElementById("milestoneFirst");
  const mFirstStatus = document.getElementById("milestoneFirstStatus");
  if (mFirst) {
    mFirst.setAttribute("data-unlocked", unlocks.firstStep ? "true" : "false");
  }
  if (mFirstStatus) {
    mFirstStatus.textContent = unlocks.firstStep ? "Unlocked ✨" : "1 session";
  }

  const mGoal = document.getElementById("milestoneGoal");
  const mGoalStatus = document.getElementById("milestoneGoalStatus");
  if (mGoal) {
    mGoal.setAttribute("data-unlocked", unlocks.dailyGoal ? "true" : "false");
  }
  if (mGoalStatus) {
    mGoalStatus.textContent = unlocks.dailyGoal
      ? "Achieved 🎯"
      : `${todayMinutes}/${DAILY_GOAL_MINUTES}m`;
  }

  const mStreak3 = document.getElementById("milestoneStreak3");
  const mStreak3Status = document.getElementById("milestoneStreak3Status");
  if (mStreak3) {
    mStreak3.setAttribute("data-unlocked", unlocks.streak3 ? "true" : "false");
  }
  if (mStreak3Status) {
    mStreak3Status.textContent = unlocks.streak3
      ? "Active 🌿"
      : `${Math.min(3, streakCount)}/3 days`;
  }

  const mStreak7 = document.getElementById("milestoneStreak7");
  const mStreak7Status = document.getElementById("milestoneStreak7Status");
  if (mStreak7) {
    mStreak7.setAttribute("data-unlocked", unlocks.streak7 ? "true" : "false");
  }
  if (mStreak7Status) {
    mStreak7Status.textContent = unlocks.streak7
      ? "Rooted 🏆"
      : `${Math.min(7, streakCount)}/7 days`;
  }

  const summary = document.getElementById("milestonesUnlockedCount");
  if (summary) {
    const totalUnlocked = Object.values(unlocks).filter(Boolean).length;
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
// Module Exports for Testing
// -----------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MODE_CONFIG,
    DAILY_GOAL_MINUTES,
    parseDuration,
    formatDuration,
    calculateProgress,
    getLocalDateString,
    getYesterdayDateString,
    getTodayFocusMinutes,
    getTotalFocusSessions,
    calculateStreak,
    checkMilestoneUnlocks,
    createDefaultState,
  };
}
