// Ad blocker for Oscilla (plugin API 1). Moved out of the Oscilla core as is.
//
// 1. Response pruning (the real fix): strips ad-scheduling fields from
//    YouTube's own API responses before the page reads them, so the player
//    never schedules an ad. Only deletes keys already in a response bound
//    for the page; never blocks, delays or rewrites a request, and never
//    touches telemetry/attestation endpoints (log_event, att/*).
// 2. Anything that slips through (e.g. server-side stitched ads, which no
//    response-based approach can remove) is muted, hidden with opacity (not
//    display/visibility, which stalls WebKit's decoder) and skipped by
//    clicking the skip button once, like a person would. Never seeks and
//    never changes playbackRate (that traffic pattern invites bot checks).

var AD_RESPONSE_ENDPOINTS = [
  '/youtubei/v1/player',
  '/youtubei/v1/next',
  '/youtubei/v1/get_watch',
  '/youtubei/v1/browse',
  '/youtubei/v1/guide'
];

var AD_PRUNE_KEY_PATHS = [
  'adPlacements',
  'adSlots',
  'playerAds',
  'adBreakHeartbeatParams',
  'playerResponse.adPlacements',
  'playerResponse.adSlots',
  'playerResponse.playerAds',
  'playerResponse.adBreakHeartbeatParams',
  'playerResponse.auxiliaryUi.messageRenderers.upsellDialogRenderer',
  'auxiliaryUi.messageRenderers.upsellDialogRenderer'
];

var SKIP_BUTTON_SELECTOR =
  '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button, .ytp-ad-skip-button-container button, .ytp-ad-skip-button-slot button';

// Plain tag selectors: this runs from a MutationObserver on <body>, where
// a :has() would re-scan the whole document on every burst of DOM churn.
var BANNER_SELECTOR = 'ytmusic-mealbar-promo-renderer, ytmusic-upsell-dialog-renderer';

var DOM_SWEEP_DELAY_MS = 300;
var TICK_SKIP_CHECK_INTERVAL_MS = 1000;

var AD_VIDEO_HIDE_STYLE =
  '.ad-showing video, .ad-interrupting video { opacity: 0 !important; pointer-events: none !important; }';

var AD_CHROME_HIDE_STYLE =
  '.ytp-ad-player-overlay, .ytp-ad-overlay-container, .ytp-ad-module, ytmusic-mealbar-promo-renderer,' +
  ' ytmusic-upsell-dialog-renderer, .ytmusic-popup-container:has(ytmusic-upsell-dialog-renderer),' +
  ' #premium-badge, .companion-ad-container {' +
  ' display: none !important; opacity: 0 !important; pointer-events: none !important; visibility: hidden !important; }';

function isAdResponseUrl(url) {
  return AD_RESPONSE_ENDPOINTS.some(function (endpoint) {
    return url.indexOf(endpoint) !== -1;
  });
}

function deleteNestedKey(obj, dottedPath) {
  var parts = dottedPath.split('.');
  var cursor = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (cursor === null || typeof cursor !== 'object') return false;
    cursor = cursor[parts[i]];
  }
  var last = parts[parts.length - 1];
  if (cursor !== null && typeof cursor === 'object' && Object.prototype.hasOwnProperty.call(cursor, last)) {
    delete cursor[last];
    return true;
  }
  return false;
}

function pruneAdFields(obj) {
  if (obj === null || typeof obj !== 'object') return false;
  var pruned = false;
  AD_PRUNE_KEY_PATHS.forEach(function (path) {
    if (deleteNestedKey(obj, path)) pruned = true;
  });
  return pruned;
}

function isAdShowingFromClassList(classList) {
  var classes = new Set(classList);
  return classes.has('ad-showing') || classes.has('ad-interrupting');
}

// Edge-triggered: mute when an ad starts, restore the user's own mute
// state when it ends.
function computeMuteSync(showing, state, currentMuted) {
  if (showing && !state.adWasShowing) {
    return { nextState: { adWasShowing: true, preAdMuted: currentMuted }, setMutedTo: true };
  }
  if (!showing && state.adWasShowing) {
    return { nextState: { adWasShowing: false, preAdMuted: state.preAdMuted }, setMutedTo: state.preAdMuted };
  }
  return { nextState: state, setMutedTo: null };
}

function shouldRunTickSafetyNet(nowMs, lastRunMs, intervalMs) {
  return nowMs - lastRunMs >= intervalMs;
}

function start(ytmd, window, document) {
  var enabled = true;
  var muteState = { adWasShowing: false, preAdMuted: false };
  var clicked = new WeakSet();
  var lastObservedPlayer = null;
  var playerObserver = null;
  var lastTickCheck = 0;

  // Response pruning, installed at document start (runAt), before the
  // page's own scripts and its first fetch.
  var nativeFetch = window.fetch;
  var originalFetch = nativeFetch.bind(window);
  window.fetch = Object.assign(function () {
    var args = arguments;
    return originalFetch.apply(null, args).then(function (response) {
      var input = args[0];
      var url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!enabled || !isAdResponseUrl(url)) return response;
      return response
        .clone()
        .json()
        .then(function (json) {
          if (!pruneAdFields(json)) return response;
          var headers = new Headers(response.headers);
          headers.delete('content-length');
          headers.delete('content-encoding');
          return new Response(JSON.stringify(json), { status: response.status, statusText: response.statusText, headers: headers });
        })
        .catch(function () {
          return response;
        });
    });
  }, nativeFetch);

  var originalParse = JSON.parse;
  JSON.parse = function () {
    var result = originalParse.apply(JSON, arguments);
    if (enabled) pruneAdFields(result);
    return result;
  };

  var initialResponse;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    configurable: true,
    enumerable: true,
    get: function () {
      return initialResponse;
    },
    set: function (next) {
      if (enabled) pruneAdFields(next);
      initialResponse = next;
    }
  });

  var removeStyle = ytmd.ui.addStyle(AD_VIDEO_HIDE_STYLE + AD_CHROME_HIDE_STYLE);

  function moviePlayer() {
    return document.getElementById('movie_player');
  }

  function syncMute() {
    var video = ytmd.page.getVideo();
    var player = moviePlayer();
    if (!video) return;
    var result = computeMuteSync(Boolean(player && isAdShowingFromClassList(player.classList)), muteState, video.muted);
    muteState = result.nextState;
    if (result.setMutedTo !== null) video.muted = result.setMutedTo;
  }

  function clickOnce(el) {
    if (clicked.has(el)) return;
    clicked.add(el);
    el.click();
  }

  function skipAndDismiss() {
    document.querySelectorAll(SKIP_BUTTON_SELECTOR).forEach(clickOnce);
    document.querySelectorAll(BANNER_SELECTOR).forEach(function (el) {
      var dismiss = el.querySelector('#dismiss-button, button[aria-label*="Dismiss"], #secondary-button');
      if (dismiss) clickOnce(dismiss);
    });
  }

  function attachPlayerObserver() {
    var player = moviePlayer();
    lastObservedPlayer = player;
    if (playerObserver) playerObserver.disconnect();
    if (!player) return;
    playerObserver = new MutationObserver(function () {
      syncMute();
      skipAndDismiss();
    });
    playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  var sweepTimer = null;
  var domObserver = new MutationObserver(function () {
    if (sweepTimer !== null) return;
    sweepTimer = setTimeout(function () {
      sweepTimer = null;
      skipAndDismiss();
    }, DOM_SWEEP_DELAY_MS);
  });

  function onReady() {
    domObserver.observe(document.body, { childList: true, subtree: true });
    attachPlayerObserver();
    skipAndDismiss();
    syncMute();
  }
  if (document.body) onReady();
  else document.addEventListener('DOMContentLoaded', onReady, { once: true });

  // Safety net on the player's tick: re-attach if YTM swapped the player,
  // re-sync mute, and sweep for skip buttons at most once a second.
  ytmd.player.onTick(function () {
    if (moviePlayer() !== lastObservedPlayer) attachPlayerObserver();
    syncMute();
    var now = Date.now();
    if (shouldRunTickSafetyNet(now, lastTickCheck, TICK_SKIP_CHECK_INTERVAL_MS)) {
      lastTickCheck = now;
      skipAndDismiss();
    }
  });

  ytmd.onUnload(function () {
    enabled = false;
    if (playerObserver) playerObserver.disconnect();
    domObserver.disconnect();
    if (sweepTimer !== null) clearTimeout(sweepTimer);
    removeStyle();
    var video = ytmd.page.getVideo();
    if (video && muteState.adWasShowing) video.muted = muteState.preAdMuted;
  });
}

if (typeof ytmd !== 'undefined') {
  start(ytmd, window, document);
}

if (typeof module !== 'undefined') {
  module.exports = {
    AD_RESPONSE_ENDPOINTS: AD_RESPONSE_ENDPOINTS,
    AD_VIDEO_HIDE_STYLE: AD_VIDEO_HIDE_STYLE,
    BANNER_SELECTOR: BANNER_SELECTOR,
    computeMuteSync: computeMuteSync,
    deleteNestedKey: deleteNestedKey,
    isAdResponseUrl: isAdResponseUrl,
    isAdShowingFromClassList: isAdShowingFromClassList,
    pruneAdFields: pruneAdFields,
    shouldRunTickSafetyNet: shouldRunTickSafetyNet
  };
}
