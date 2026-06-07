const defaultSettings = {
  blockComments: false,
  blockRecommendations: false,
  blockShorts: false,
  blockFeed: false,
  vkBlockedSections: []
};

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

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message
  });
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1;
}

function sendMessageToSupportedTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    const isSupportedUrl = (url) => {
      const normalizedUrl = String(url || '');
      return (
        normalizedUrl.includes('rutube.ru') ||
        normalizedUrl.includes('youtube.com') ||
        normalizedUrl.includes('vk.com') ||
        normalizedUrl.includes('vkvideo.ru')
      );
    };

    tabs
      .filter((tab) => isSupportedUrl(tab.url))
      .forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, message, () => {
        chrome.runtime.lastError;
      });
    });
  });
}

function setBlockingSettings(enabled, callback) {
  const settings = {
    blockComments: enabled,
    blockRecommendations: enabled,
    blockShorts: enabled,
    blockFeed: enabled,
    vkBlockedSections: enabled
      ? ['profile', 'feed', 'messenger', 'calls', 'friends', 'communities', 'photos', 'music', 'video', 'clips', 'games', 'market']
      : []
  };

  chrome.storage.sync.set(settings, () => {
    sendMessageToSupportedTabs({ action: 'updateSettings', settings });
    callback?.(settings);
  });
}

function schedulePomodoroAlarm(state) {
  chrome.alarms.clear('pomodoro');

  if (!state.pomodoroRunning || !state.pomodoroEndAt) {
    return;
  }

  chrome.alarms.create('pomodoro', {
    when: Number(state.pomodoroEndAt)
  });
}

function syncAlarmFromStorage() {
  chrome.storage.local.get(pomodoroDefaults, schedulePomodoroAlarm);
}

function saveFocusStats(state, callback) {
  const today = getTodayKey();
  const sessionId = state.focusSessionId || '';

  if (sessionId && state.focusStatsSavedFor === sessionId) {
    callback?.();
    return;
  }

  const dateChanged = state.focusStatsDate !== today;
  const plannedMinutes = Number(state.pomodoroMinutes) || pomodoroDefaults.pomodoroMinutes;
  const total = Number(state.focusMinutesTotal) || 0;
  const todayMinutes = dateChanged ? 0 : Number(state.focusMinutesToday) || 0;
  const todaySessions = dateChanged ? 0 : Number(state.focusSessionsToday) || 0;

  chrome.storage.local.set({
    focusMinutesTotal: total + plannedMinutes,
    focusMinutesToday: todayMinutes + plannedMinutes,
    focusSessionsToday: todaySessions + 1,
    focusStatsDate: today,
    focusStatsSavedFor: sessionId
  }, callback);
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
      schedulePomodoroAlarm({ pomodoroRunning: true, pomodoroEndAt: endAt });
    });
  });
}

function finishFocusAndStartBreak(state) {
  saveFocusStats(state, () => {
    const breakMinutes = Number(state.breakMinutes) || pomodoroDefaults.breakMinutes;
    const breakEndAt = Date.now() + breakMinutes * 60 * 1000;

    setBlockingSettings(false, () => {
      chrome.storage.local.set({
        pomodoroEndAt: breakEndAt,
        pomodoroRunning: true,
        pomodoroMode: 'break',
        focusStartedAt: 0,
        focusSessionId: ''
      }, () => {
        notify('Фокус завершен', `Начался отдых ${breakMinutes} минут.`);
        schedulePomodoroAlarm({ pomodoroRunning: true, pomodoroEndAt: breakEndAt });
      });
    });
  });
}

function finishBreak(state) {
  notify('Отдых завершен', state.autoStartFocus ? 'Начинаю следующий фокус.' : 'Можно начинать следующий фокус.');

  if (state.autoStartFocus) {
    startFocus(Number(state.pomodoroMinutes) || pomodoroDefaults.pomodoroMinutes);
    return;
  }

  chrome.storage.local.set({
    pomodoroEndAt: 0,
    pomodoroRunning: false,
    pomodoroMode: 'idle',
    focusStartedAt: 0,
    focusSessionId: ''
  });
}

function handlePomodoroAlarm() {
  chrome.storage.local.get(pomodoroDefaults, (state) => {
    if (!state.pomodoroRunning || Number(state.pomodoroEndAt) > Date.now()) {
      schedulePomodoroAlarm(state);
      return;
    }

    if (state.pomodoroMode === 'focus') {
      finishFocusAndStartBreak(state);
    } else {
      finishBreak(state);
    }
  });
}

chrome.runtime.onInstalled.addListener(syncAlarmFromStorage);
chrome.runtime.onStartup.addListener(syncAlarmFromStorage);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === 'local' &&
    (changes.pomodoroEndAt || changes.pomodoroRunning || changes.pomodoroMode)
  ) {
    chrome.storage.local.get(pomodoroDefaults, schedulePomodoroAlarm);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pomodoro') {
    handlePomodoroAlarm();
  }
});

