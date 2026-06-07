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
  focusSessionId: '',
  focusStatsSavedFor: '',
  focusMinutesTotal: 0
};

const hiddenElementSelector = [
  '[data-focus-guard-comments="true"]',
  '[data-focus-guard-recommendations="true"]',
  '[data-focus-guard-sidebar="true"]',
  '[data-focus-guard-shorts="true"]',
  '[data-focus-guard-feed="true"]',
  '[data-focus-guard-vk-nav="true"]'
].join(', ');

const vkMenuSectionKeys = [
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

let settings = { ...defaultSettings };
let pomodoroEndAt = 0;
let pomodoroRunning = false;
let pomodoroMode = 'idle';
let focusSessionId = '';
let pomodoroCheckTimer = null;

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

function getSite() {
  const hostname = window.location.hostname;

  if (hostname.includes('youtube.com')) {
    return 'youtube';
  }

  if (hostname.includes('rutube.ru')) {
    return 'rutube';
  }

  if (hostname.includes('vk.com') || hostname.includes('vkvideo.ru')) {
    return 'vk';
  }

  return 'unknown';
}

function getSiteHomeUrl(site) {
  if (site === 'youtube') {
    return 'https://www.youtube.com/';
  }

  if (site === 'rutube') {
    return 'https://rutube.ru/';
  }

  if (site === 'vk') {
    return 'https://vk.com/video';
  }

  return '/';
}

function isVideoWatchPage(site = getSite()) {
  const path = String(window.location.pathname || '').toLowerCase();

  if (site === 'youtube') {
    return path === '/watch';
  }

  if (site === 'rutube') {
    return path.includes('/video/');
  }

  if (site === 'vk') {
    return path.includes('/video') || path.includes('/clip') || path.includes('/clips');
  }

  return false;
}

function rememberAndHide(element, marker) {
  if (
    !element ||
    element === document.body ||
    element === document.documentElement ||
    element.hasAttribute('data-focus-guard-comments') ||
    element.hasAttribute('data-focus-guard-recommendations') ||
    element.hasAttribute('data-focus-guard-sidebar') ||
    element.hasAttribute('data-focus-guard-shorts') ||
    element.hasAttribute('data-focus-guard-feed') ||
    element.hasAttribute('data-focus-guard-vk-nav')
  ) {
    return;
  }

  if (marker === 'data-focus-guard-comments' && element.querySelector('video')) {
    return;
  }

  if (marker === 'data-focus-guard-comments') {
    const rect = element.getBoundingClientRect();
    const hidesAlmostWholePage = rect.width >= window.innerWidth * 0.97 && rect.height >= window.innerHeight * 1.2;
    if (hidesAlmostWholePage) {
      return;
    }
  }

  const previousDisplay = element.style.display && element.style.display !== 'none'
    ? element.style.display
    : '';

  element.setAttribute(marker, 'true');
  element.setAttribute('data-focus-guard-previous-display', previousDisplay);
  element.style.display = 'none';
}

function restoreHiddenElements(selector = hiddenElementSelector) {
  let restored = false;

  document.querySelectorAll(selector).forEach((element) => {
    const previousDisplay = element.getAttribute('data-focus-guard-previous-display') || '';

    element.removeAttribute('data-focus-guard-comments');
    element.removeAttribute('data-focus-guard-recommendations');
    element.removeAttribute('data-focus-guard-sidebar');
    element.removeAttribute('data-focus-guard-shorts');
    element.removeAttribute('data-focus-guard-feed');
    element.removeAttribute('data-focus-guard-vk-nav');
    element.removeAttribute('data-focus-guard-vk-section');
    element.removeAttribute('data-focus-guard-previous-display');

    if (previousDisplay) {
      element.style.display = previousDisplay;
    } else {
      element.style.removeProperty('display');
    }

    restored = true;
  });

  if (restored) {
    document.body.offsetHeight;
    window.dispatchEvent(new Event('resize'));
  }
}

function finishPomodoroIfExpired() {
  return false;
}

function finishFocusAndStartBreakFromPage() {
  chrome.storage.local.get(pomodoroDefaults, (state) => {
    saveFocusStatsFromPage(state, () => {
      const breakMinutes = Number(state.breakMinutes) || pomodoroDefaults.breakMinutes;
      const breakEndAt = Date.now() + breakMinutes * 60 * 1000;

      pomodoroEndAt = breakEndAt;
      pomodoroRunning = true;
      pomodoroMode = 'break';
      focusSessionId = '';
      settings = { ...defaultSettings };

      chrome.storage.sync.set({ blockComments: false, blockRecommendations: false, blockShorts: false, blockFeed: false, vkBlockedSections: [] });
      chrome.storage.local.set({
        pomodoroEndAt: breakEndAt,
        pomodoroRunning: true,
        pomodoroMode: 'break',
        focusSessionId: ''
      });
      restoreHiddenElements();
      showNotification('Фокус завершен. Начался отдых 5 минут.');
    });
  });
}

function saveFocusStatsFromPage(state, callback) {
  const sessionId = state.focusSessionId || focusSessionId || '';

  if (sessionId && state.focusStatsSavedFor === sessionId) {
    callback?.();
    return;
  }

  const plannedMinutes = Number(state.pomodoroMinutes) || pomodoroDefaults.pomodoroMinutes;
  const previousTotal = Number(state.focusMinutesTotal) || 0;

  chrome.storage.local.set({
    focusMinutesTotal: previousTotal + plannedMinutes,
    focusStatsSavedFor: sessionId
  }, callback);
}

function finishBreakFromPage() {
  pomodoroEndAt = 0;
  pomodoroRunning = false;
  pomodoroMode = 'idle';
  focusSessionId = '';
  chrome.storage.local.set({
    pomodoroEndAt: 0,
    pomodoroRunning: false,
    pomodoroMode: 'idle',
    focusSessionId: ''
  });
  showNotification('Отдых завершен.');
}

function applyBlocker() {
  finishPomodoroIfExpired();
  settings = normalizeSettings(settings);
  const isYouTube = getSite() === 'youtube';
  const shouldBlockRecommendations = settings.blockRecommendations === true;
  const selectedVkMenuSections = new Set(Array.isArray(settings.vkBlockedSections) ? settings.vkBlockedSections : []);

  repairYouTubeMainPage();

  document.documentElement.classList.remove('focus-guard-block-youtube-shorts');
  document.documentElement.classList.toggle('focus-guard-youtube-wide-video', isYouTube && shouldBlockRecommendations);
  document.documentElement.classList.remove('focus-guard-comfort-video');
  vkMenuSectionKeys.forEach((key) => {
    document.documentElement.classList.toggle(`focus-guard-hide-vk-${key}`, selectedVkMenuSections.has(key));
  });

  if (!shouldBlockRecommendations) {
    document.documentElement.classList.remove('focus-guard-youtube-wide-video');
    document.documentElement.classList.remove('focus-guard-comfort-video');
  }

  runBlockerStep(() => {
    if (settings.blockComments) {
      blockComments();
    } else {
      restoreHiddenElements('[data-focus-guard-comments="true"]');
    }
  });

  runBlockerStep(() => {
    if (settings.blockRecommendations) {
      blockRecommendations();
    } else {
      restoreHiddenElements('[data-focus-guard-recommendations="true"], [data-focus-guard-sidebar="true"]');
    }
  });

  runBlockerStep(() => {
    if (settings.blockShorts) {
      blockShorts();
    } else {
      restoreHiddenElements('[data-focus-guard-shorts="true"]');
    }
  });

  runBlockerStep(() => {
    if (settings.blockFeed) {
      blockFeed();
    } else {
      document.documentElement.classList.remove('focus-guard-block-vk-feed');
      restoreHiddenElements('[data-focus-guard-feed="true"]');
    }
  });

  runBlockerStep(() => {
    if (Array.isArray(settings.vkBlockedSections) && settings.vkBlockedSections.length > 0) {
      blockVkMenuSections(settings.vkBlockedSections);
    } else {
      restoreHiddenElements('[data-focus-guard-vk-nav="true"]');
    }
  });
}

function runBlockerStep(callback) {
  try {
    callback();
  } catch (error) {
    console.warn('Focus Guard blocker step failed:', error);
  }
}

function repairYouTubeMainPage() {
  if (getSite() !== 'youtube' || isVideoWatchPage('youtube')) {
    return;
  }

  document.documentElement.classList.remove('focus-guard-youtube-wide-video');
  document.documentElement.classList.remove('focus-guard-comfort-video');

  [
    'ytd-rich-grid-renderer',
    'ytd-rich-grid-row',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-rich-section-renderer',
    'ytd-rich-shelf-renderer',
    'ytd-browse ytd-two-column-browse-results-renderer',
    'ytd-browse #contents'
  ].forEach((selector) => {
    safeQuerySelectorAll(selector).forEach((element) => {
      element.removeAttribute('data-focus-guard-comments');
      element.removeAttribute('data-focus-guard-recommendations');
      element.removeAttribute('data-focus-guard-sidebar');
      element.removeAttribute('data-focus-guard-shorts');
      element.removeAttribute('data-focus-guard-previous-display');
      element.style.removeProperty('display');
    });
  });
}

function getNormalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasAnyKeyword(value, keywords) {
  const text = getNormalizedText(value);
  return keywords.some((keyword) => text.includes(keyword));
}

function findCommentContainer(element) {
  const player = document.querySelector('video');
  const playerRect = player?.getBoundingClientRect();
  let current = element;
  let bestCandidate = null;

  for (let depth = 0; depth < 7 && current; depth += 1) {
    if (current.querySelector('video')) {
      break;
    }

    const rect = current.getBoundingClientRect();
    const idAndClass = `${current.id || ''} ${current.className || ''}`.toLowerCase();
    const isLargeEnough = rect.width >= 320 && rect.height >= 120;
    const isTooLarge = rect.width >= window.innerWidth * 0.97 && rect.height >= window.innerHeight * 1.2;
    const isBelowPlayer = !playerRect || rect.top >= playerRect.bottom - 24;
    const looksLikePageShell = idAndClass.includes('page') || idAndClass.includes('layout') || idAndClass.includes('content');
    const looksLikeComments = idAndClass.includes('comment') || idAndClass.includes('reply') || idAndClass.includes('discuss');

    if (isLargeEnough && !isTooLarge && isBelowPlayer && (!looksLikePageShell || looksLikeComments)) {
      bestCandidate = current;
    }

    current = current.parentElement;
  }

  return bestCandidate || null;
}

function blockComments() {
  const site = getSite();

  if (site === 'youtube') {
    blockYouTubeComments();
    return;
  }

  if (site === 'vk') {
    blockVkComments();
    return;
  }

  [
    '[class*="comments"]',
    '.comments-section',
    '#comments',
    '[data-testid*="comments"]',
    '.video-comments',
    '.comments-block'
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      rememberAndHide(element, 'data-focus-guard-comments');
    });
  });
}

function blockVkComments() {
  if (!isVideoWatchPage('vk')) {
    return;
  }

  const video = document.querySelector('video');
  const playerRect = video?.getBoundingClientRect();
  const hidden = new WeakSet();

  function isCommentRowCandidate(element) {
    if (!element || hidden.has(element)) {
      return false;
    }

    if (element.querySelector('video')) {
      return false;
    }

    if (element.querySelector('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]')) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 420 || rect.height < 60 || rect.height > 620) {
      return false;
    }

    if (rect.left > window.innerWidth * 0.55) {
      return false;
    }

    if (rect.width > window.innerWidth * 0.96 && rect.height > window.innerHeight * 0.65) {
      return false;
    }

    if (playerRect && rect.top < playerRect.bottom - 16) {
      return false;
    }

    const text = getNormalizedText(element.textContent);
    if (!text) {
      return false;
    }

    const isHeader = text.includes('\u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440') && (text.includes('\u0441\u043d\u0430\u0447\u0430\u043b\u0430') || /\d+\s*\u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440/.test(text));
    if (isHeader) {
      return false;
    }

    const hasCommentSignals =
      text.includes('\u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c') ||
      text.includes('\u043e\u0442\u0432\u0435\u0442\u043e\u0432') ||
      text.includes('\u043c\u0438\u043d\u0443\u0442 \u043d\u0430\u0437\u0430\u0434') ||
      text.includes('\u0447\u0430\u0441') ||
      text.includes('\u0434\u0435\u043d\u044c \u043d\u0430\u0437\u0430\u0434') ||
      text.includes('\u0434\u043d\u044f \u043d\u0430\u0437\u0430\u0434') ||
      text.includes('\u0434\u043d\u0435\u0439 \u043d\u0430\u0437\u0430\u0434');

    return hasCommentSignals;
  }

  function hideCommentRowFromNode(node) {
    let current = node.closest('div, article, li');

    for (let depth = 0; depth < 7 && current; depth += 1) {
      if (isCommentRowCandidate(current)) {
        hidden.add(current);
        rememberAndHide(current, 'data-focus-guard-comments');
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  safeQuerySelectorAll('a, button, span, div').forEach((node) => {
    const text = getNormalizedText(node.textContent);
    if (text.includes('\u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c')) {
      hideCommentRowFromNode(node);
    }
  });

  safeQuerySelectorAll('div, article, li').forEach((element) => {
    if (!isCommentRowCandidate(element)) {
      return;
    }

    const text = getNormalizedText(element.textContent);
    const likelyComment = text.includes('\u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c') || text.includes('\u043e\u0442\u0432\u0435\u0442\u043e\u0432');

    if (likelyComment) {
      hidden.add(element);
      rememberAndHide(element, 'data-focus-guard-comments');
    }
  });

  blockVkCommentRowsByTextSignals(playerRect);
  blockVkCommentReplyLinks(playerRect);
  blockVkCommentsLoadingIndicators(playerRect);
}

function blockVkCommentRowsByTextSignals(playerRect) {
  const commentSignals = [
    '\u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c',
    '\u043e\u0442\u0432\u0435\u0442\u043e\u0432',
    '\u043c\u0438\u043d\u0443\u0442\u0443 \u043d\u0430\u0437\u0430\u0434',
    '\u043c\u0438\u043d\u0443\u0442 \u043d\u0430\u0437\u0430\u0434',
    '\u0447\u0430\u0441 \u043d\u0430\u0437\u0430\u0434',
    '\u0447\u0430\u0441\u0430 \u043d\u0430\u0437\u0430\u0434',
    '\u0447\u0430\u0441\u043e\u0432 \u043d\u0430\u0437\u0430\u0434',
    '\u0434\u0435\u043d\u044c \u043d\u0430\u0437\u0430\u0434',
    '\u0434\u043d\u044f \u043d\u0430\u0437\u0430\u0434',
    '\u0434\u043d\u0435\u0439 \u043d\u0430\u0437\u0430\u0434'
  ];

  function looksLikeCommentRow(element) {
    if (!element || element === document.body || element === document.documentElement) {
      return false;
    }

    if (element.querySelector('video, textarea, [contenteditable="true"], [role="textbox"], input[type="text"]')) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 180 || rect.height < 18 || rect.height > 420) {
      return false;
    }

    if (rect.left > window.innerWidth * 0.62) {
      return false;
    }

    if (rect.width > window.innerWidth * 0.98 && rect.height > window.innerHeight * 0.45) {
      return false;
    }

    if (playerRect && rect.top < playerRect.bottom - 16) {
      return false;
    }

    const text = getNormalizedText(element.textContent);
    if (!text) {
      return false;
    }

    const isCommentsHeader =
      text.includes('\u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440') &&
      (text.includes('\u0441\u043d\u0430\u0447\u0430\u043b\u0430') || /\d+\s*\u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440/.test(text));

    if (isCommentsHeader) {
      return false;
    }

    return commentSignals.some((signal) => text.includes(signal));
  }

  function findSmallCommentRow(node) {
    let current = node.closest?.('div, article, li');
    let best = null;

    for (let depth = 0; depth < 8 && current; depth += 1) {
      if (looksLikeCommentRow(current)) {
        best = current;
      }

      const rect = current.getBoundingClientRect();
      if (rect.height > 420 || rect.width > window.innerWidth * 0.98) {
        break;
      }

      current = current.parentElement;
    }

    return best;
  }

  safeQuerySelectorAll('a, button, span, div').forEach((node) => {
    const text = getNormalizedText(node.textContent);
    if (!commentSignals.some((signal) => text.includes(signal))) {
      return;
    }

    const row = findSmallCommentRow(node);
    if (row) {
      rememberAndHide(row, 'data-focus-guard-comments');
    } else if (looksLikeCommentRow(node)) {
      rememberAndHide(node, 'data-focus-guard-comments');
    }
  });
}

function findVkCommentsHeaderRect() {
  let bestRect = null;

  safeQuerySelectorAll('div, span, h2, h3').forEach((element) => {
    if (bestRect) {
      return;
    }

    const text = getNormalizedText(element.textContent);
    const looksLikeHeader =
      /\d+\s*\u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440/.test(text) &&
      (
        text.includes('\u0441\u043d\u0430\u0447\u0430\u043b\u0430') ||
        text.length < 90
      );

    if (!looksLikeHeader) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const isMainColumnHeader =
      rect.width > 80 &&
      rect.height > 10 &&
      rect.left < window.innerWidth * 0.55;

    if (isMainColumnHeader) {
      bestRect = rect;
    }
  });

  return bestRect;
}

function blockVkCommentReplyLinks(playerRect) {
  safeQuerySelectorAll('a, button, span, div').forEach((element) => {
    if (element.querySelector('video, textarea, [contenteditable="true"], [role="textbox"], input[type="text"]')) {
      return;
    }

    const text = getNormalizedText(element.textContent);
    const isReplyLink = /^\d+\s*(\u043e\u0442\u0432\u0435\u0442|\u043e\u0442\u0432\u0435\u0442\u0430|\u043e\u0442\u0432\u0435\u0442\u043e\u0432)$/.test(text);

    if (!isReplyLink) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const isMainColumn = rect.left < window.innerWidth * 0.62;
    const isSmallRow = rect.width > 30 && rect.width < 220 && rect.height > 12 && rect.height < 50;
    const isBelowPlayer = !playerRect || rect.top > playerRect.bottom - 16;

    if (isMainColumn && isSmallRow && isBelowPlayer) {
      const target = element.closest('div, button, a') || element;
      rememberAndHide(target, 'data-focus-guard-comments');
    }
  });
}

function blockVkCommentsLoadingIndicators(playerRect) {
  const selectors = [
    '[class*="loader"]',
    '[class*="Loader"]',
    '[class*="spinner"]',
    '[class*="Spinner"]',
    '[role="progressbar"]',
    '.progress'
  ];

  selectors.forEach((selector) => {
    safeQuerySelectorAll(selector).forEach((element) => {
      if (element.querySelector('video')) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const isSmallLoader = rect.width > 8 && rect.width < 90 && rect.height > 8 && rect.height < 90;
      const isMainColumn = rect.left < window.innerWidth * 0.62;
      const isBelowPlayer = !playerRect || rect.top > playerRect.bottom - 16;

      if (isSmallLoader && isMainColumn && isBelowPlayer) {
        rememberAndHide(element, 'data-focus-guard-comments');
      }
    });
  });
}

function blockVkCommentsByReplyRows() {
  const video = document.querySelector('video');
  const playerRect = video?.getBoundingClientRect();
  let blocked = false;

  function isValidCommentBlock(element) {
    if (!element || element.querySelector('video')) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 420 || rect.height < 70 || rect.height > 760) {
      return false;
    }

    if (playerRect && rect.top < playerRect.bottom - 20) {
      return false;
    }

    const text = getNormalizedText(element.textContent);
    const hasCommentSignals =
      text.includes('\u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c') ||
      text.includes('\u043e\u0442\u0432\u0435\u0442\u043e\u0432') ||
      text.includes('\u0434\u043d\u0435\u0439 \u043d\u0430\u0437\u0430\u0434') ||
      text.includes('\u0447\u0430\u0441\u043e\u0432 \u043d\u0430\u0437\u0430\u0434') ||
      text.includes('\u043c\u0438\u043d\u0443\u0442 \u043d\u0430\u0437\u0430\u0434');

    return hasCommentSignals;
  }

  safeQuerySelectorAll('a, button, span, div').forEach((node) => {
    const text = getNormalizedText(node.textContent);
    if (!text.includes('\u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c') && !text.includes('reply')) {
      return;
    }

    let current = node.closest('div, article, li');
    for (let depth = 0; depth < 7 && current; depth += 1) {
      if (isValidCommentBlock(current)) {
        rememberAndHide(current, 'data-focus-guard-comments');
        blocked = true;
        break;
      }

      current = current.parentElement;
    }
  });

  safeQuerySelectorAll('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]').forEach((input) => {
    const placeholder = getNormalizedText(`${input.getAttribute('placeholder') || ''} ${input.getAttribute('aria-label') || ''}`);
    if (!placeholder.includes('\u043a\u043e\u043c\u043c\u0435\u043d\u0442') && !placeholder.includes('comment')) {
      return;
    }

    let current = input.closest('div, form, section');
    for (let depth = 0; depth < 6 && current; depth += 1) {
      if (isValidCommentBlock(current) || current.querySelector('a, button, span')?.textContent?.includes('\u041e\u0442\u0432\u0435\u0442\u0438\u0442\u044c')) {
        rememberAndHide(current, 'data-focus-guard-comments');
        blocked = true;
        break;
      }

      current = current.parentElement;
    }
  });

  safeQuerySelectorAll('div, span, h2, h3').forEach((node) => {
    const text = getNormalizedText(node.textContent);
    if (!(text.includes('\u043a\u043e\u043c\u043c\u0435\u043d\u0442') || text.includes('\u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u0438\u043d\u0442\u0435\u0440\u0435\u0441\u043d\u044b\u0435'))) {
      return;
    }

    let current = node.closest('div, section, article');
    for (let depth = 0; depth < 6 && current; depth += 1) {
      const rect = current.getBoundingClientRect();
      if (
        !current.querySelector('video') &&
        rect.width >= 520 &&
        rect.height >= 40 &&
        (!playerRect || rect.top >= playerRect.bottom - 20)
      ) {
        rememberAndHide(current, 'data-focus-guard-comments');
        blocked = true;
        break;
      }

      current = current.parentElement;
    }
  });

  return blocked;
}

function blockVkCommentsByHeader() {
  const video = document.querySelector('video');
  const playerRect = video?.getBoundingClientRect();
  let blocked = false;

  document.querySelectorAll('section, div, h1, h2, h3, span').forEach((element) => {
    const text = getNormalizedText(element.textContent);
    if (!text) {
      return;
    }

    const hasCommentsWord = text.includes('\u043a\u043e\u043c\u043c\u0435\u043d\u0442') || text.includes('comments');
    const hasSortLabel = text.includes('\u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u0438\u043d\u0442\u0435\u0440\u0435\u0441\u043d\u044b\u0435') || text.includes('interesting');
    const hasCountPattern = /\b\d{2,}\s*\u043a\u043e\u043c\u043c\u0435\u043d\u0442/.test(text);

    if (!hasCommentsWord || (!hasSortLabel && !hasCountPattern)) {
      return;
    }

    let container = element.closest('section, div, article');

    for (let depth = 0; depth < 8 && container; depth += 1) {
      if (container.querySelector('video')) {
        break;
      }

      const rect = container.getBoundingClientRect();
      const belowPlayer = !playerRect || rect.top >= playerRect.bottom - 20;
      const notTooHuge = !(rect.width > window.innerWidth * 0.99 && rect.height > window.innerHeight * 2);
      const containerText = getNormalizedText(container.textContent);
      const hasReplyText = containerText.includes('\u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c') || containerText.includes('\u043e\u0442\u0432\u0435\u0442\u043e\u0432');
      const looksLikeCommentsArea =
        rect.width >= 520 &&
        rect.height >= 220 &&
        (
          container.querySelector('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]') ||
          container.querySelector('[class*="reply"], [class*="comment"], [data-testid*="comment"]') ||
          hasReplyText
        );

      if (belowPlayer && notTooHuge && looksLikeCommentsArea) {
        rememberAndHide(container, 'data-focus-guard-comments');
        blocked = true;
        return;
      }

      container = container.parentElement;
    }
  });

  return blocked;
}

function blockVkCommentsByContent() {
  const video = document.querySelector('video');
  const playerRect = video?.getBoundingClientRect();
  let blocked = false;

  const commentSignals = [
    '\u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c',
    '\u043e\u0442\u0432\u0435\u0442\u043e\u0432',
    '\u0434\u043d\u0435\u0439 \u043d\u0430\u0437\u0430\u0434',
    '\u0447\u0430\u0441\u043e\u0432 \u043d\u0430\u0437\u0430\u0434',
    '\u043c\u0438\u043d\u0443\u0442 \u043d\u0430\u0437\u0430\u0434',
    '\u043a\u043e\u043c\u043c\u0435\u043d\u0442',
    'reply',
    'replies',
    'comments'
  ];

  document.querySelectorAll('section, div, article').forEach((element) => {
    if (element.querySelector('video')) {
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 320 || rect.height < 180) {
      return;
    }

    if (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 1.2) {
      return;
    }

    if (playerRect && rect.top < playerRect.bottom - 10) {
      return;
    }

    const text = getNormalizedText(element.textContent);
    let signalCount = 0;
    commentSignals.forEach((signal) => {
      if (text.includes(signal)) {
        signalCount += 1;
      }
    });

    const likelyCommentItems = element.querySelectorAll('a[href*="reply"], [id*="reply"], [class*="reply"], [class*="comment"], [data-testid*="comment"]').length;
    const hasInput = element.querySelector('textarea, [contenteditable="true"], input[type="text"]');

    if (signalCount >= 2 && (likelyCommentItems >= 3 || hasInput)) {
      rememberAndHide(element, 'data-focus-guard-comments');
      blocked = true;
    }
  });

  return blocked;
}
function blockSidebarAroundPlayer(marker) {
  const video = document.querySelector('video');
  if (!video) {
    return false;
  }

  const playerRect = video.getBoundingClientRect();
  let blocked = false;

  document.querySelectorAll('aside, section, div').forEach((element) => {
    const rect = element.getBoundingClientRect();
    const isRightColumn = rect.left > Math.max(playerRect.right - 32, window.innerWidth * 0.58);
    const hasReasonableWidth = rect.width >= 220 && rect.width <= 560;
    const hasReasonableHeight = rect.height >= 120;
    const nearPlayer = rect.top < playerRect.bottom + 280;
    const hasVideoInside = element.querySelector('video');
    const linksCount = element.querySelectorAll('a[href]').length;

    if (
      isRightColumn &&
      hasReasonableWidth &&
      hasReasonableHeight &&
      nearPlayer &&
      !hasVideoInside &&
      linksCount >= 3
    ) {
      rememberAndHide(element, marker);
      blocked = true;
    }
  });

  return blocked;
}

function blockCommentPanelsAroundPlayer() {
  const video = document.querySelector('video');
  if (!video) {
    return false;
  }

  const commentKeywords = ['\u043a\u043e\u043c\u043c\u0435\u043d\u0442', '\u043e\u0431\u0441\u0443\u0436\u0434\u0435\u043d', 'discussion', 'comments', 'replies'];
  const playerRect = video.getBoundingClientRect();
  let blocked = false;

  document.querySelectorAll('section, div, article').forEach((element) => {
    const rect = element.getBoundingClientRect();
    const belowPlayer = rect.top >= playerRect.bottom - 20;
    const nearWidth = rect.width > Math.min(playerRect.width * 0.6, 420);
    const hasReplies = element.querySelectorAll('[class*="reply"], [id*="reply"], [data-testid*="reply"]').length > 0;
    const textLooksLikeComments = hasAnyKeyword(element.textContent, commentKeywords);

    if (belowPlayer && nearWidth && (hasReplies || textLooksLikeComments)) {
      rememberAndHide(element, 'data-focus-guard-comments');
      blocked = true;
    }
  });

  return blocked;
}
function blockYouTubeComments() {
  [
    '#comments',
    'ytd-comments',
    'ytd-item-section-renderer#sections'
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      rememberAndHide(element, 'data-focus-guard-comments');
    });
  });
}

function blockRecommendations() {
  const site = getSite();

  if (site === 'youtube') {
    blockYouTubeRecommendations();
    return;
  }

  if (site === 'vk') {
    blockVkRecommendations();
    return;
  }

  if (!isVideoWatchPage('rutube')) {
    return;
  }

  const recommendationSelectors = [
    '.video-page__content > div:last-child',
    '.player + div',
    '[class*="recommendations"]',
    '[class*="related"]',
    '[class*="suggestions"]',
    '.video-recommendations',
    '.recommendations-block',
    '.related-videos',
    '.layout__right-column',
    '.page-layout__right',
    '.video-player__sidebar'
  ];

  let blocked = false;

  recommendationSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      const isVideoPlayer = element.querySelector('video') !== null ||
        element.classList.contains('video-player') ||
        element.classList.contains('player');
      const rect = element.getBoundingClientRect();
      const isOnRightSide = rect.left > window.innerWidth / 2;

      if (!isVideoPlayer && isOnRightSide) {
        rememberAndHide(element, 'data-focus-guard-recommendations');
        blocked = true;
      }
    });
  });

  if (!blocked) {
    findAndBlockSidebarByPosition();
  }
}

function blockVkRecommendations() {
  if (!isVideoWatchPage('vk')) {
    return;
  }

  const recommendationSelectors = [
    '#mv_recom',
    '#video_recom',
    '[id*="recom"]',
    '.mv_recom_block',
    '.video_layer_recoms_wrap',
    '.VideoRecomBlock',
    '.VideoRecommendationsBlock__root',
    '[class*="recommend"]',
    '[class*="Recommendations"]',
    '[class*="Recom"]',
    '[class*="sidebar"]',
    '[class*="Sidebar"]',
    '[class*="rightColumn"]',
    '[class*="RightColumn"]',
    '[class*="related"]',
    '[data-testid*="recommend"]',
    '[data-testid*="recommendation"]'
  ];

  let blocked = false;

  recommendationSelectors.forEach((selector) => {
    safeQuerySelectorAll(selector).forEach((element) => {
      const isVideoPlayer = element.querySelector('video') !== null;
      const rect = element.getBoundingClientRect();
      const isOnRightSide = rect.left > window.innerWidth / 2;

      if (!isVideoPlayer && isOnRightSide) {
        rememberAndHide(element, 'data-focus-guard-recommendations');
        blocked = true;
      }
    });
  });

  if (!blocked && !blockSidebarAroundPlayer('data-focus-guard-recommendations')) {
    findAndBlockSidebarByPosition();
  }
}

function blockYouTubeRecommendations() {
  if (!isVideoWatchPage('youtube')) {
    return;
  }

  [
    '#related',
    'ytd-watch-next-secondary-results-renderer',
    'ytd-compact-video-renderer',
    '#secondary',
    '#secondary-inner'
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      rememberAndHide(element, 'data-focus-guard-recommendations');
    });
  });
}

function findAndBlockSidebarByPosition() {
  const videoPlayer = document.querySelector('video');

  if (!videoPlayer) {
    return;
  }

  const playerContainer = videoPlayer.closest('div');

  if (!playerContainer) {
    return;
  }

  const playerRect = playerContainer.getBoundingClientRect();

  document.querySelectorAll('div').forEach((element) => {
    const rect = element.getBoundingClientRect();
    const isRightOfPlayer = rect.left > playerRect.right - 50;
    const isNearPlayer = rect.top < playerRect.bottom + 200;
    const canBeSidebar = rect.width > 0 && rect.width < 500;
    const hasVideo = element.querySelector('video');
    const isControl = element.classList.contains('controls') ||
      element.classList.contains('player-controls');

    if (isRightOfPlayer && isNearPlayer && canBeSidebar && !hasVideo && !isControl) {
      rememberAndHide(element, 'data-focus-guard-recommendations');
    }
  });
}

function blockShorts() {
  const site = getSite();

  if (site === 'youtube') {
    blockYouTubeShorts();
    return;
  }

  if (site === 'vk') {
    blockVkShorts();
    return;
  }

  if (isShortsUrl(window.location.href)) {
    window.location.replace(getSiteHomeUrl(site));
    return;
  }

  document.querySelectorAll('a[href]').forEach((link) => {
    if (isShortsUrl(link.getAttribute('href'))) {
      rememberAndHide(findSafeShortsTarget(link), 'data-focus-guard-shorts');
    }
  });

  document.querySelectorAll('a, button, [role="tab"], [role="link"], [role="menuitem"]').forEach((element) => {
    if (isShortsMenuText(element.textContent) || isShortsMenuText(element.getAttribute('aria-label'))) {
      rememberAndHide(findSafeShortsTarget(element), 'data-focus-guard-shorts');
    }
  });
}

function blockFeed() {
  const site = getSite();

  if (site !== 'vk') {
    return;
  }

  const hostname = String(window.location.hostname || '').toLowerCase();
  const path = String(window.location.pathname || '').toLowerCase();
  const search = String(window.location.search || '').toLowerCase();
  const isVkSocial = hostname.includes('vk.com') && !hostname.includes('vkvideo.ru');
  const isVideoRoute = path.includes('/video') || path.includes('/clip') || path.includes('/clips');
  const isFeedRoute = path === '/' || path === '/feed' || search.includes('act=home');

  if (!isVkSocial || isVideoRoute || !isFeedRoute) {
    document.documentElement.classList.remove('focus-guard-block-vk-feed');
    restoreHiddenElements('[data-focus-guard-feed="true"]');
    return;
  }

  document.documentElement.classList.add('focus-guard-block-vk-feed');
  blockVkFeed();
}

function blockVkFeed() {
  const selectors = [
    '#feed_rows',
    '#news_feed',
    '.feed_rows',
    '.feed_row',
    '.feed_post',
    '.feed_w',
    '.wall_posts',
    '.wall_posts_wrap',
    '.wall_item',
    '.wall_post_cont',
    '.post',
    '.Post',
    '[id^="post"]',
    '[data-post-id]',
    '[data-testid*="post"]',
    '[class*="wallItem"]',
    '[class*="WallItem"]',
    '[class*="feedRow"]',
    '[class*="FeedRow"]',
    '[data-testid*="feed"]',
    '[class*="FeedPost"]',
    '[class*="newsfeed"]'
  ];

  const hidden = new WeakSet();

  function hideFeedElement(element) {
    if (!element || hidden.has(element) || element === document.body || element === document.documentElement) {
      return;
    }

    const idAndClass = getNormalizedText(`${element.id || ''} ${element.className || ''}`);
    const looksLikeFeed =
      idAndClass.includes('feed') ||
      idAndClass.includes('news') ||
      element.closest('#feed_rows, #news_feed, .feed_rows, .feed_row, [class*="Feed"], [class*="feed"]');

    if (!looksLikeFeed) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const tooSmall = rect.width < 300 || rect.height < 70;
    const tooHuge = rect.width > window.innerWidth * 0.98 && rect.height > window.innerHeight * 1.5;

    if (tooSmall || tooHuge) {
      return;
    }

    hidden.add(element);
    rememberAndHide(element, 'data-focus-guard-feed');
  }

  selectors.forEach((selector) => {
    safeQuerySelectorAll(selector).forEach((element) => {
      hideFeedElement(element);
      Array.from(element.children || []).forEach((child) => {
        if (child instanceof HTMLElement) {
          hideFeedElement(child);
        }
      });
    });
  });
}

function blockVkMenuSections(blockedSections) {
  const site = getSite();
  if (site !== 'vk') {
    return;
  }

  const hostname = String(window.location.hostname || '').toLowerCase();
  if (!hostname.includes('vk.com') || hostname.includes('vkvideo.ru')) {
    return;
  }

  function findVkMenuTarget(node) {
    const candidates = [
      node.closest('a[href]'),
      node.closest('li'),
      node.closest('[role="link"]'),
      node.closest('[class*="left_nav"]'),
      node.closest('[class*="LeftMenuItem"]'),
      node.closest('[class*="MenuItem"]')
    ].filter(Boolean);

    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      const text = getNormalizedText(candidate.textContent);
      const isHeaderOrLogo =
        rect.top < 72 ||
        text.includes('\u0432\u043a\u043e\u043d\u0442\u0430\u043a\u0442\u0435') ||
        text === 'vk';
      const isSingleMenuRow =
        rect.width > 24 &&
        rect.width < 320 &&
        rect.height > 18 &&
        rect.height < 72 &&
        text.length < 80;

      if (!isHeaderOrLogo && isSingleMenuRow && !candidate.querySelector('video')) {
        return candidate;
      }
    }

    return null;
  }

  const sectionMap = {
    profile: { labels: ['\u043f\u0440\u043e\u0444\u0438\u043b\u044c', 'profile'], hrefParts: ['/id', '/club', '/public'] },
    feed: { labels: ['\u043b\u0435\u043d\u0442\u0430', 'news'], hrefParts: ['/feed', 'act=home'] },
    messenger: { labels: ['\u043c\u0435\u0441\u0441\u0435\u043d\u0434\u0436\u0435\u0440', '\u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f', 'messenger', 'messages'], hrefParts: ['/im', 'sel='] },
    calls: { labels: ['\u0437\u0432\u043e\u043d\u043a\u0438', 'calls'], hrefParts: ['/calls'] },
    friends: { labels: ['\u0434\u0440\u0443\u0437\u044c\u044f', 'friends'], hrefParts: ['/friends'] },
    communities: { labels: ['\u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u0430', 'groups', 'communities'], hrefParts: ['/groups'] },
    photos: { labels: ['\u0444\u043e\u0442\u043e', 'photos'], hrefParts: ['/photos', 'z=photo'] },
    music: { labels: ['\u043c\u0443\u0437\u044b\u043a\u0430', 'music'], hrefParts: ['/music', '/audios'] },
    video: { labels: ['\u0432\u0438\u0434\u0435\u043e', 'video'], hrefParts: ['/video'] },
    clips: { labels: ['\u043a\u043b\u0438\u043f\u044b', 'clips'], hrefParts: ['/clips', '/clip'] },
    games: { labels: ['\u0438\u0433\u0440\u044b', 'games'], hrefParts: ['/games'] },
    market: { labels: ['\u043c\u0430\u0440\u043a\u0435\u0442', 'market'], hrefParts: ['/market'] }
  };

  const selected = new Set(blockedSections.filter((key) => sectionMap[key]));
  if (!selected.size) {
    restoreHiddenElements('[data-focus-guard-vk-nav="true"]');
    return;
  }

  document.querySelectorAll('[data-focus-guard-vk-nav="true"]').forEach((element) => {
    const sectionKey = element.getAttribute('data-focus-guard-vk-section') || '';

    if (!sectionKey || !selected.has(sectionKey)) {
      const previousDisplay = element.getAttribute('data-focus-guard-previous-display') || '';

      element.removeAttribute('data-focus-guard-vk-nav');
      element.removeAttribute('data-focus-guard-vk-section');
      element.removeAttribute('data-focus-guard-previous-display');

      if (previousDisplay) {
        element.style.display = previousDisplay;
      } else {
        element.style.removeProperty('display');
      }
    }
  });

  const candidates = safeQuerySelectorAll('a[href], [role="link"], button');
  candidates.forEach((node) => {
    const text = getNormalizedText(node.textContent);
    const href = getNormalizedText(node.getAttribute?.('href') || '');
    if (!text && !href) {
      return;
    }

    for (const key of selected) {
      const config = sectionMap[key];
      const matchesText = config.labels.some((label) => text === label || text.startsWith(`${label} `));
      const matchesHref = config.hrefParts.some((part) => href.includes(part));

      if (!matchesText && !matchesHref) {
        continue;
      }

      const target = findVkMenuTarget(node);

      if (target && target.getAttribute('data-focus-guard-vk-section') !== key) {
        rememberAndHide(target, 'data-focus-guard-vk-nav');
        target.setAttribute('data-focus-guard-vk-section', key);
      }
      break;
    }
  });
}

function blockVkShorts() {
  if (isShortsUrl(window.location.href)) {
    window.location.replace(getSiteHomeUrl('vk'));
    return;
  }

  [
    'a[href*="/clips"]',
    'a[href*="/clip/"]',
    '[class*="clip"]',
    '[class*="Clip"]'
  ].forEach((selector) => {
    safeQuerySelectorAll(selector).forEach((element) => {
      rememberAndHide(findSafeShortsTarget(element), 'data-focus-guard-shorts');
    });
  });

  document.querySelectorAll('a, button, [role="tab"], [role="link"], [role="menuitem"]').forEach((element) => {
    if (isShortsMenuText(element.textContent) || isShortsMenuText(element.getAttribute('aria-label'))) {
      rememberAndHide(findSafeShortsTarget(element), 'data-focus-guard-shorts');
    }
  });
}

function blockYouTubeShorts() {
  if (isShortsUrl(window.location.href)) {
    window.location.replace(getSiteHomeUrl('youtube'));
    return;
  }

  restoreHiddenElements([
    'ytd-rich-item-renderer[data-focus-guard-shorts="true"]',
    'ytd-video-renderer[data-focus-guard-shorts="true"]',
    'ytd-grid-video-renderer[data-focus-guard-shorts="true"]',
    'ytd-rich-section-renderer[data-focus-guard-shorts="true"]',
    'ytd-rich-shelf-renderer[data-focus-guard-shorts="true"]'
  ].join(', '));

  [
    'ytd-reel-shelf-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytm-reel-shelf-renderer'
  ].forEach((selector) => {
    safeQuerySelectorAll(selector).forEach((element) => {
      rememberAndHide(element, 'data-focus-guard-shorts');
    });
  });

  document.querySelectorAll('a[href*="/shorts"], a[title="Shorts"], a[aria-label="Shorts"], button, [role="tab"], [role="link"], [role="menuitem"], ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, tp-yt-paper-item, yt-formatted-string').forEach((element) => {
    if (isShortsMenuText(element.textContent) || isShortsMenuText(element.getAttribute('aria-label')) || isShortsMenuText(element.getAttribute('title'))) {
      const target = findYouTubeShortsTarget(element);

      if (target) {
        rememberAndHide(target, 'data-focus-guard-shorts');
      }
    }
  });
}

function safeQuerySelectorAll(selector) {
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch (error) {
    return [];
  }
}

function isShortsUrl(value) {
  const normalizedValue = String(value || '').toLowerCase();

  return (
    normalizedValue.includes('/shorts') ||
    normalizedValue.includes('/clips') ||
    normalizedValue.includes('/clip/')
  );
}

function isShortsMenuText(value) {
  const text = String(value || '').trim().toLowerCase();
  return (
    text === 'shorts' ||
    text === 'rutube shorts' ||
    text === 'clips' ||
    text === 'vk clips' ||
    text === '�����' ||
    text === '����� ��' ||
    text === 'шортс' ||
    text === 'шортсы'
  );
}

function findSafeShortsTarget(element) {
  let current = element;

  for (let depth = 0; depth < 5 && current && current.parentElement; depth += 1) {
    const rect = current.getBoundingClientRect();
    const parentRect = current.parentElement.getBoundingClientRect();
    const text = (current.textContent || '').trim();

    if (
      (isShortsUrl(current.getAttribute?.('href')) || isShortsMenuText(text)) &&
      rect.width >= 40 &&
      rect.width <= 360 &&
      rect.height >= 20 &&
      rect.height <= 90
    ) {
      return current;
    }

    if (parentRect.width > 420 || parentRect.height > 140) {
      return current;
    }

    current = current.parentElement;
  }

  return element;
}

function findYouTubeShortsTarget(element) {
  const closestTarget = element.closest?.([
    'ytd-guide-entry-renderer',
    'ytd-mini-guide-entry-renderer',
    'tp-yt-paper-item',
    'ytm-pivot-bar-item-renderer',
    'ytd-reel-shelf-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytm-reel-shelf-renderer'
  ].join(', '));

  if (closestTarget) {
    return closestTarget;
  }

  return findSafeShortsTarget(element);
}

function showNotification(message) {
  const existingNotification = document.querySelector('.focus-guard-notification');

  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement('div');
  notification.className = 'focus-guard-notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #ff4d4d;
    color: white;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    animation: slideIn 0.3s ease;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function syncStateAndApply() {
  chrome.storage.sync.get(defaultSettings, (storedSettings) => {
    settings = normalizeSettings({ ...defaultSettings, ...storedSettings });

    chrome.storage.local.get(pomodoroDefaults, (pomodoroState) => {
      pomodoroEndAt = Number(pomodoroState.pomodoroEndAt) || 0;
      pomodoroRunning = Boolean(pomodoroState.pomodoroRunning);
      pomodoroMode = pomodoroState.pomodoroMode || 'idle';
      focusSessionId = pomodoroState.focusSessionId || '';
      applyBlocker();
    });
  });
}

function startPomodoroWatcher() {
  if (pomodoroCheckTimer) {
    clearInterval(pomodoroCheckTimer);
  }

  pomodoroCheckTimer = setInterval(() => {
    if (finishPomodoroIfExpired()) {
      showNotification('Помодоро завершен.');
    }

    applyBlocker();
  }, 1000);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    Object.keys(changes).forEach((key) => {
      settings[key] = changes[key].newValue;
    });
    settings = normalizeSettings({ ...defaultSettings, ...settings });
  }

  if (areaName === 'local' && changes.pomodoroEndAt) {
    pomodoroEndAt = Number(changes.pomodoroEndAt.newValue) || 0;
  }

  if (areaName === 'local' && changes.pomodoroRunning) {
    pomodoroRunning = Boolean(changes.pomodoroRunning.newValue);
  }

  if (areaName === 'local' && changes.pomodoroMode) {
    pomodoroMode = changes.pomodoroMode.newValue || 'idle';
  }

  if (areaName === 'local' && changes.focusSessionId) {
    focusSessionId = changes.focusSessionId.newValue || '';
  }

  applyBlocker();
});

const observer = new MutationObserver(() => {
  applyBlocker();
});

if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refresh') {
    syncStateAndApply();
    showNotification('Блокировка обновлена.');
    sendResponse({ success: true });
  } else if (request.action === 'updateSettings') {
    settings = normalizeSettings({ ...defaultSettings, ...(request.settings || {}) });
    applyBlocker();
    sendResponse({ success: true });
  } else if (request.action === 'startPomodoro') {
    settings = normalizeSettings({ ...defaultSettings, ...(request.settings || settings) });
    pomodoroEndAt = Number(request.pomodoroEndAt) || 0;
    pomodoroRunning = true;
    pomodoroMode = request.pomodoroMode || 'focus';
    focusSessionId = request.focusSessionId || '';
    applyBlocker();
    showNotification('Помодоро запущен.');
    sendResponse({ success: true });
  } else if (request.action === 'stopPomodoro') {
    pomodoroEndAt = 0;
    pomodoroRunning = false;
    pomodoroMode = 'idle';
    focusSessionId = '';
    chrome.storage.local.set({ pomodoroEndAt: 0, pomodoroRunning: false, pomodoroMode: 'idle', focusSessionId: '' });
    chrome.storage.sync.set({ blockComments: false, blockRecommendations: false, blockShorts: false, blockFeed: false, vkBlockedSections: [] });
    settings = { ...defaultSettings };
    applyBlocker();
    showNotification('Помодоро остановлен.');
    sendResponse({ success: true });
  } else if (request.action === 'updatePomodoro') {
    syncStateAndApply();
    sendResponse({ success: true });
  }

  return true;
});

const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  html.focus-guard-block-youtube-shorts ytd-reel-shelf-renderer,
  html.focus-guard-block-youtube-shorts ytd-reel-item-renderer,
  html.focus-guard-block-youtube-shorts ytm-shorts-lockup-view-model,
  html.focus-guard-block-youtube-shorts ytm-reel-shelf-renderer {
    display: none !important;
  }

  html.focus-guard-youtube-wide-video ytd-watch-flexy #secondary,
  html.focus-guard-youtube-wide-video ytd-watch-flexy #secondary-inner,
  html.focus-guard-youtube-wide-video ytd-watch-next-secondary-results-renderer {
    display: none !important;
  }

  html.focus-guard-block-vk-feed #feed_rows,
  html.focus-guard-block-vk-feed #news_feed,
  html.focus-guard-block-vk-feed .feed_rows,
  html.focus-guard-block-vk-feed .feed_row,
  html.focus-guard-block-vk-feed .feed_post,
  html.focus-guard-block-vk-feed .feed_w,
  html.focus-guard-block-vk-feed .wall_posts,
  html.focus-guard-block-vk-feed .wall_posts_wrap,
  html.focus-guard-block-vk-feed .wall_item,
  html.focus-guard-block-vk-feed .wall_post_cont,
  html.focus-guard-block-vk-feed [id^="post"],
  html.focus-guard-block-vk-feed [data-post-id],
  html.focus-guard-block-vk-feed [data-testid*="post"],
  html.focus-guard-block-vk-feed [data-testid*="feed"],
  html.focus-guard-block-vk-feed [class*="feedRow"],
  html.focus-guard-block-vk-feed [class*="FeedRow"],
  html.focus-guard-block-vk-feed [class*="FeedPost"],
  html.focus-guard-block-vk-feed [class*="newsfeed"] {
    display: none !important;
  }

  html.focus-guard-hide-vk-profile #l_pr,
  html.focus-guard-hide-vk-feed #l_nwsf,
  html.focus-guard-hide-vk-messenger #l_msg,
  html.focus-guard-hide-vk-friends #l_fr,
  html.focus-guard-hide-vk-communities #l_gr,
  html.focus-guard-hide-vk-photos #l_ph,
  html.focus-guard-hide-vk-music #l_aud,
  html.focus-guard-hide-vk-video #l_vid,
  html.focus-guard-hide-vk-games #l_ap,
  html.focus-guard-hide-vk-market #l_mk {
    display: none !important;
  }

`;
document.head.appendChild(style);

document.addEventListener('visibilitychange', applyBlocker);
document.addEventListener('click', (event) => {
  if (!settings.blockShorts) {
    return;
  }

  const link = event.target.closest?.('a, [role="link"], [role="tab"], [role="menuitem"]');

  if (!link) {
    return;
  }

  if (isShortsUrl(link.getAttribute('href')) || isShortsMenuText(link.textContent)) {
    event.preventDefault();
    event.stopPropagation();
    showNotification('Shorts скрыты Focus Guard.');
  }
}, true);
window.addEventListener('focus', applyBlocker);
window.addEventListener('pageshow', applyBlocker);

syncStateAndApply();
startPomodoroWatcher();


