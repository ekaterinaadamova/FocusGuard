const defaultSettings = {
  blockComments: false,
  blockRecommendations: false,
  blockShorts: false,
  blockFeed: false,
  vkBlockedSections: []
};

const vkSectionOptions = [
  'profile',
  'feed',
  'messenger',
  'calls',
  'friends',
  'communities',
  'photos',
  'music',
  'video',
  'clips',
  'games',
  'market'
];

const pomodoroDefaults = {
  pomodoroEndAt: 0,
  pomodoroRunning: false,
  pomodoroMode: 'idle',
  pomodoroMinutes: 25,
  breakMinutes: 5,
  autoStartFocus: false,
  focusStartedAt: 0,
  focusSessionId: '',
  focusStatsSavedFor: '',
  focusMinutesTotal: 0,
  focusMinutesToday: 0,
  focusSessionsToday: 0,
  focusStatsDate: ''
};

let countdownTimer = null;

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1;
}

function normalizeSettings(rawSettings = {}) {
  return {
    blockComments: normalizeBoolean(rawSettings.blockComments),
    blockRecommendations: normalizeBoolean(rawSettings.blockRecommendations),
    blockShorts: normalizeBoolean(rawSettings.blockShorts),
    blockFeed: normalizeBoolean(rawSettings.blockFeed),
    vkBlockedSections: Array.isArray(rawSettings.vkBlockedSections) ? rawSettings.vkBlockedSections : []
  };
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeMinutes(value, fallback) {
  const minutes = Number.parseInt(value, 10);

  if (Number.isNaN(minutes)) {
    return fallback;
  }

  return Math.min(180, Math.max(1, minutes));
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message
  });
}

function showButtonStatus(text) {
  const btn = document.getElementById('refreshBtn');
  const originalText = btn.textContent;

  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = originalText;
  }, 1500);
}

function getActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    callback(tabs[0]);
  });
}

function isSupportedUrl(url) {
  const normalizedUrl = String(url || '');

  return (
    normalizedUrl.includes('rutube.ru') ||
    normalizedUrl.includes('youtube.com') ||
    normalizedUrl.includes('vk.com') ||
    normalizedUrl.includes('vkvideo.ru')
  );
}

function sendMessageToActiveSupportedTab(message, callback) {
  getActiveTab((tab) => {
    if (!tab || !isSupportedUrl(tab.url)) {
      callback?.(false);
      return;
    }

    chrome.tabs.sendMessage(tab.id, message, () => {
      callback?.(!chrome.runtime.lastError);
    });
  });
}

function sendMessageToSupportedTabs(message, callback) {
  chrome.tabs.query({}, (tabs) => {
    const supportedTabs = tabs.filter((tab) => isSupportedUrl(tab.url));

    if (!supportedTabs.length) {
      callback?.(false);
      return;
    }

    let pending = supportedTabs.length;
    let sent = false;

    supportedTabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, message, () => {
        if (!chrome.runtime.lastError) {
          sent = true;
        }

        pending -= 1;
        if (pending === 0) {
          callback?.(sent);
        }
      });
    });
  });
}

function getSettingsFromUi() {
  const vkBlockedSections = vkSectionOptions.filter((key) => {
    const checkbox = document.querySelector(`[data-vk-section="${key}"]`);
    return checkbox?.checked;
  });

  return {
    blockComments: document.getElementById('blockComments').checked,
    blockRecommendations: document.getElementById('blockRecommendations').checked,
    blockShorts: document.getElementById('blockShorts').checked,
    blockFeed: document.getElementById('blockFeed').checked,
    vkBlockedSections
  };
}

function renderSettings(settings) {
  settings = normalizeSettings({ ...defaultSettings, ...settings });

  document.getElementById('blockComments').checked = settings.blockComments;
  document.getElementById('blockRecommendations').checked = settings.blockRecommendations;
  document.getElementById('blockShorts').checked = settings.blockShorts;
  document.getElementById('blockFeed').checked = settings.blockFeed;

  const selected = new Set(Array.isArray(settings.vkBlockedSections) ? settings.vkBlockedSections : []);
  vkSectionOptions.forEach((key) => {
    const checkbox = document.querySelector(`[data-vk-section="${key}"]`);
    if (checkbox) {
      checkbox.checked = selected.has(key);
    }
  });
}

function setBlockingSettings(enabled, callback) {
  const settings = {
    blockComments: enabled,
    blockRecommendations: enabled,
    blockShorts: enabled,
    blockFeed: enabled,
    vkBlockedSections: enabled ? [...vkSectionOptions] : []
  };

  renderSettings(settings);

  chrome.storage.sync.set(settings, () => {
    sendMessageToSupportedTabs({ action: 'updateSettings', settings });
    callback?.(settings);
  });
}

function loadSettings() {
  chrome.storage.sync.get(defaultSettings, (storedSettings) => {
    const settings = normalizeSettings({ ...defaultSettings, ...storedSettings });
    renderSettings(settings);
    chrome.storage.sync.set(settings);
  });
}

function saveSettings() {
  const settings = getSettingsFromUi();

  chrome.storage.sync.set(settings, () => {
    sendMessageToSupportedTabs({ action: 'updateSettings', settings });
    showButtonStatus('OK, сохранено');
  });
}

function getCleanStats(state) {
  const today = getTodayKey();
  const dateChanged = state.focusStatsDate !== today;

  return {
    total: Number(state.focusMinutesTotal) || 0,
    today: dateChanged ? 0 : Number(state.focusMinutesToday) || 0,
    sessionsToday: dateChanged ? 0 : Number(state.focusSessionsToday) || 0
  };
}

function updatePomodoroUi(state) {
  const endAt = Number(state.pomodoroEndAt) || 0;
  const mode = state.pomodoroMode || 'idle';
  const focusMinutes = normalizeMinutes(state.pomodoroMinutes, pomodoroDefaults.pomodoroMinutes);
  const breakMinutes = normalizeMinutes(state.breakMinutes, pomodoroDefaults.breakMinutes);
  const remaining = endAt - Date.now();
  const isRunning = Boolean(state.pomodoroRunning) && remaining > 0;
  const isBreak = isRunning && mode === 'break';
  const stats = getCleanStats(state);

  document.getElementById('pomodoroTime').textContent = isRunning
    ? formatTime(remaining)
    : `${String(focusMinutes).padStart(2, '0')}:00`;
  document.getElementById('pomodoroMinutes').value = focusMinutes;
  document.getElementById('breakMinutes').value = breakMinutes;
  document.getElementById('autoStartFocus').checked = Boolean(state.autoStartFocus);
  document.getElementById('pomodoroMinutes').disabled = isRunning;
  document.getElementById('breakMinutes').disabled = isRunning;
  document.getElementById('startPomodoroBtn').disabled = isRunning;
  document.getElementById('stopPomodoroBtn').disabled = !isRunning;
  document.getElementById('skipBreakBtn').disabled = !isBreak;
  document.getElementById('addFiveBtn').disabled = !isRunning;
  document.getElementById('focusStatsToday').textContent = `${Math.round(stats.today)} мин`;
  document.getElementById('focusStatsTotal').textContent = `${Math.round(stats.total)} мин`;
  document.getElementById('focusSessionsToday').textContent = `${Math.round(stats.sessionsToday)}`;

  if (isRunning && mode === 'focus') {
    document.getElementById('pomodoroStatus').textContent = 'Фокус идет. Все блокировки включены.';
  } else if (isRunning && mode === 'break') {
    document.getElementById('pomodoroStatus').textContent = `Отдых ${breakMinutes} минут. Блокировки выключены.`;
  } else {
    document.getElementById('pomodoroStatus').textContent = 'Старт включает блокировки, потом запускает отдых.';
  }
}

function loadPomodoro() {
  chrome.storage.local.get(pomodoroDefaults, updatePomodoroUi);
}

function startCountdownLoop() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  countdownTimer = setInterval(() => {
    chrome.storage.local.get(pomodoroDefaults, (state) => {
      if (state.pomodoroRunning && Number(state.pomodoroEndAt) <= Date.now()) {
        finishPomodoroPhase(state);
        return;
      }

      updatePomodoroUi(state);
    });
  }, 1000);
}

function saveDurations(callback) {
  const focusMinutes = normalizeMinutes(
    document.getElementById('pomodoroMinutes').value,
    pomodoroDefaults.pomodoroMinutes
  );
  const breakMinutes = normalizeMinutes(
    document.getElementById('breakMinutes').value,
    pomodoroDefaults.breakMinutes
  );

  chrome.storage.local.set({ pomodoroMinutes: focusMinutes, breakMinutes }, () => {
    callback?.({ focusMinutes, breakMinutes });
  });
}

function saveAutoStart() {
  chrome.storage.local.set({
    autoStartFocus: document.getElementById('autoStartFocus').checked
  });
}

function startFocus(minutes) {
  const now = Date.now();
  const endAt = now + minutes * 60 * 1000;
  const focusSessionId = String(now);

  setBlockingSettings(true, (settings) => {
    chrome.storage.local.set({
      pomodoroEndAt: endAt,
      pomodoroRunning: true,
      pomodoroMode: 'focus',
      pomodoroMinutes: minutes,
      focusStartedAt: now,
      focusSessionId
    }, () => {
      sendMessageToSupportedTabs({
        action: 'startPomodoro',
        settings,
        pomodoroEndAt: endAt,
        pomodoroMode: 'focus',
        focusSessionId
      });
      chrome.storage.local.get(pomodoroDefaults, updatePomodoroUi);
    });
  });
}

function startPomodoro() {
  saveDurations(({ focusMinutes }) => {
    startFocus(focusMinutes);
  });
}

function finishPomodoroPhase(state) {
  if (state.pomodoroMode === 'focus') {
    finishFocusAndStartBreak(state);
    return;
  }

  finishBreak(state);
}

function finishFocusAndStartBreak(state) {
  saveFocusStats(state, () => {
    const breakMinutes = normalizeMinutes(state.breakMinutes, pomodoroDefaults.breakMinutes);
    const breakEndAt = Date.now() + breakMinutes * 60 * 1000;

    setBlockingSettings(false, () => {
      chrome.storage.local.set({
        pomodoroEndAt: breakEndAt,
        pomodoroRunning: true,
        pomodoroMode: 'break',
        focusStartedAt: 0,
        focusSessionId: ''
      }, () => {
        chrome.storage.local.get(pomodoroDefaults, updatePomodoroUi);
      });
    });
  });
}

function saveFocusStats(state, callback) {
  const today = getTodayKey();
  const sessionId = state.focusSessionId || '';

  chrome.storage.local.get(pomodoroDefaults, (stored) => {
    if (sessionId && stored.focusStatsSavedFor === sessionId) {
      callback?.();
      return;
    }

    const dateChanged = stored.focusStatsDate !== today;
    const plannedMinutes = normalizeMinutes(stored.pomodoroMinutes, pomodoroDefaults.pomodoroMinutes);
    const total = Number(stored.focusMinutesTotal) || 0;
    const todayMinutes = dateChanged ? 0 : Number(stored.focusMinutesToday) || 0;
    const todaySessions = dateChanged ? 0 : Number(stored.focusSessionsToday) || 0;

    chrome.storage.local.set({
      focusMinutesTotal: total + plannedMinutes,
      focusMinutesToday: todayMinutes + plannedMinutes,
      focusSessionsToday: todaySessions + 1,
      focusStatsDate: today,
      focusStatsSavedFor: sessionId
    }, callback);
  });
}

function finishBreak(state) {
  if (state.autoStartFocus) {
    startFocus(normalizeMinutes(state.pomodoroMinutes, pomodoroDefaults.pomodoroMinutes));
    return;
  }

  stopPomodoroCycle(state);
}

function stopPomodoroCycle(state) {
  setBlockingSettings(false, () => {
    chrome.storage.local.set({
      pomodoroEndAt: 0,
      pomodoroRunning: false,
      pomodoroMode: 'idle',
      focusStartedAt: 0,
      focusSessionId: ''
    }, () => {
      sendMessageToSupportedTabs({ action: 'stopPomodoro' });
      updatePomodoroUi({
        ...state,
        pomodoroEndAt: 0,
        pomodoroRunning: false,
        pomodoroMode: 'idle'
      });
    });
  });
}

function stopPomodoro() {
  chrome.storage.local.get(pomodoroDefaults, stopPomodoroCycle);
}

function addFiveMinutes() {
  chrome.storage.local.get(pomodoroDefaults, (state) => {
    if (!state.pomodoroRunning) {
      return;
    }

    const updates = {
      pomodoroEndAt: Number(state.pomodoroEndAt) + 5 * 60 * 1000
    };

    if (state.pomodoroMode === 'focus') {
      updates.pomodoroMinutes = normalizeMinutes(state.pomodoroMinutes, pomodoroDefaults.pomodoroMinutes) + 5;
    } else if (state.pomodoroMode === 'break') {
      updates.breakMinutes = normalizeMinutes(state.breakMinutes, pomodoroDefaults.breakMinutes) + 5;
    }

    chrome.storage.local.set(updates);
  });
}

function skipBreak() {
  chrome.storage.local.get(pomodoroDefaults, (state) => {
    if (state.pomodoroMode === 'break') {
      finishBreak(state);
    }
  });
}

function resetStats() {
  chrome.storage.local.set({
    focusMinutesTotal: 0,
    focusMinutesToday: 0,
    focusSessionsToday: 0,
    focusStatsDate: getTodayKey(),
    focusStatsSavedFor: ''
  }, () => {
    chrome.storage.local.get(pomodoroDefaults, updatePomodoroUi);
  });
}

document.getElementById('blockComments').addEventListener('change', saveSettings);
document.getElementById('blockRecommendations').addEventListener('change', saveSettings);
document.getElementById('blockShorts').addEventListener('change', saveSettings);
document.getElementById('blockFeed').addEventListener('change', saveSettings);
document.querySelectorAll('[data-vk-section]').forEach((checkbox) => {
  checkbox.addEventListener('change', saveSettings);
});
document.getElementById('refreshBtn').addEventListener('click', () => {
  sendMessageToActiveSupportedTab({ action: 'refresh' }, (sent) => {
    showButtonStatus(sent ? 'OK, применено' : 'Откройте Rutube/YouTube/VK Video');
  });
});
document.getElementById('startPomodoroBtn').addEventListener('click', startPomodoro);
document.getElementById('stopPomodoroBtn').addEventListener('click', stopPomodoro);
document.getElementById('addFiveBtn').addEventListener('click', addFiveMinutes);
document.getElementById('skipBreakBtn').addEventListener('click', skipBreak);
document.getElementById('resetStatsBtn').addEventListener('click', resetStats);
document.getElementById('autoStartFocus').addEventListener('change', saveAutoStart);
document.getElementById('pomodoroMinutes').addEventListener('change', () => saveDurations(loadPomodoro));
document.getElementById('breakMinutes').addEventListener('change', () => saveDurations(loadPomodoro));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === 'local' &&
    (
      changes.pomodoroEndAt ||
      changes.pomodoroRunning ||
      changes.pomodoroMode ||
      changes.pomodoroMinutes ||
      changes.breakMinutes ||
      changes.autoStartFocus ||
      changes.focusMinutesTotal ||
      changes.focusMinutesToday ||
      changes.focusSessionsToday ||
      changes.focusStatsDate
    )
  ) {
    chrome.storage.local.get(pomodoroDefaults, updatePomodoroUi);
  }

  if (areaName === 'sync' && (changes.blockComments || changes.blockRecommendations || changes.blockShorts || changes.blockFeed || changes.vkBlockedSections)) {
    chrome.storage.sync.get(defaultSettings, renderSettings);
  }
});

loadSettings();
loadPomodoro();
startCountdownLoop();


