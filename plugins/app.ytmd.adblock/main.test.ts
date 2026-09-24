// Tests for the ad blocker plugin's pure logic (bun test).
import { describe, expect, test } from 'bun:test';

const {
  computeMuteSync,
  isAdShowingFromClassList,
  shouldRunTickSafetyNet,
  AD_VIDEO_HIDE_STYLE,
  deleteNestedKey,
  pruneAdFields,
  isAdResponseUrl,
  AD_RESPONSE_ENDPOINTS,
  BANNER_SELECTOR
} = require('./main.js');

describe('isAdShowingFromClassList', () => {
  test('detects ad-showing class', () => {
    expect(isAdShowingFromClassList(['html5-video-player', 'ad-showing'])).toBe(true);
  });

  test('detects ad-interrupting class', () => {
    expect(isAdShowingFromClassList(['html5-video-player', 'ad-interrupting'])).toBe(true);
  });

  test('returns false when no ad classes present', () => {
    expect(isAdShowingFromClassList(['html5-video-player', 'playing-mode'])).toBe(false);
  });

  test('returns false for an empty class list', () => {
    expect(isAdShowingFromClassList([])).toBe(false);
  });
});

describe('computeMuteSync — edge-triggered mute-only ad suppression', () => {
  const initial = { adWasShowing: false, preAdMuted: false };

  test('ad starts while unmuted: mutes and remembers prior state', () => {
    const result = computeMuteSync(true, initial, false);
    expect(result.setMutedTo).toBe(true);
    expect(result.nextState).toEqual({ adWasShowing: true, preAdMuted: false });
  });

  test('ad starts while already muted: mutes (no-op) and remembers prior state', () => {
    const result = computeMuteSync(true, initial, true);
    expect(result.setMutedTo).toBe(true);
    expect(result.nextState).toEqual({ adWasShowing: true, preAdMuted: true });
  });

  test('ad continues showing: no repeated action (edge-triggered, not level-triggered)', () => {
    const midAd = { adWasShowing: true, preAdMuted: false };
    const result = computeMuteSync(true, midAd, true);
    expect(result.setMutedTo).toBeNull();
    expect(result.nextState).toBe(midAd);
  });

  test('ad ends: restores the mute state from before the ad', () => {
    const midAd = { adWasShowing: true, preAdMuted: false };
    const result = computeMuteSync(false, midAd, true);
    expect(result.setMutedTo).toBe(false);
    expect(result.nextState).toEqual({ adWasShowing: false, preAdMuted: false });
  });

  test('ad ends when the user was muted beforehand: stays muted, does not unmute', () => {
    const midAd = { adWasShowing: true, preAdMuted: true };
    const result = computeMuteSync(false, midAd, true);
    expect(result.setMutedTo).toBe(true);
    expect(result.nextState).toEqual({ adWasShowing: false, preAdMuted: true });
  });

  test('no ad, no ad: steady state does nothing', () => {
    const result = computeMuteSync(false, initial, false);
    expect(result.setMutedTo).toBeNull();
    expect(result.nextState).toBe(initial);
  });

  test('back-to-back ads: second ad correctly re-captures the restored state', () => {
    // Ad #1: user was unmuted, ad mutes, then ad ends and restores unmuted.
    let state = initial;
    let r = computeMuteSync(true, state, false);
    state = r.nextState;
    r = computeMuteSync(false, state, true);
    state = r.nextState;
    expect(state).toEqual({ adWasShowing: false, preAdMuted: false });

    // User manually mutes between ads, then ad #2 starts — must capture the
    // new pre-ad state (muted), not the stale one from ad #1.
    r = computeMuteSync(true, state, true);
    expect(r.setMutedTo).toBe(true);
    expect(r.nextState).toEqual({ adWasShowing: true, preAdMuted: true });
  });
});

describe('shouldRunTickSafetyNet — throttles the onTick skip/dismiss safety net', () => {
  test('does not run again immediately after a run', () => {
    expect(shouldRunTickSafetyNet(1000, 1000, 1000)).toBe(false);
    expect(shouldRunTickSafetyNet(1500, 1000, 1000)).toBe(false);
  });

  test('runs once the interval has elapsed', () => {
    expect(shouldRunTickSafetyNet(2000, 1000, 1000)).toBe(true);
    expect(shouldRunTickSafetyNet(2500, 1000, 1000)).toBe(true);
  });

  test('always runs on the very first tick (lastRunMs = 0)', () => {
    // lastRunMs = 0 is the initial sentinel before any tick has run, so a
    // real Date.now() timestamp is always far past the interval from it.
    expect(shouldRunTickSafetyNet(Date.now(), 0, 1000)).toBe(true);
  });
});

describe('AD_VIDEO_HIDE_STYLE — must not suspend the ad video\'s decode pipeline', () => {
  test('never uses display or visibility to hide the ad video', () => {
    // display:none / visibility:hidden pull the element out of the render
    // tree, which makes WebKit suspend decode/paint on a hidden <video> —
    // the ad then stalls looking like it's stuck loading instead of playing
    // out silently and firing `ended` on schedule. Regression test for
    // that exact bug report.
    expect(AD_VIDEO_HIDE_STYLE).not.toMatch(/display\s*:/);
    expect(AD_VIDEO_HIDE_STYLE).not.toMatch(/visibility\s*:/);
  });

  test('hides via opacity while staying inert to clicks', () => {
    expect(AD_VIDEO_HIDE_STYLE).toMatch(/opacity\s*:\s*0\s*!important/);
    expect(AD_VIDEO_HIDE_STYLE).toMatch(/pointer-events\s*:\s*none\s*!important/);
  });

  test('targets exactly the ad-showing and ad-interrupting video', () => {
    expect(AD_VIDEO_HIDE_STYLE).toMatch(/\.ad-showing video/);
    expect(AD_VIDEO_HIDE_STYLE).toMatch(/\.ad-interrupting video/);
  });
});

describe('deleteNestedKey', () => {
  test('deletes a top-level key and reports it removed', () => {
    const obj: Record<string, unknown> = { adPlacements: [1, 2], videoDetails: {} };
    expect(deleteNestedKey(obj, 'adPlacements')).toBe(true);
    expect(obj).not.toHaveProperty('adPlacements');
    expect(obj).toHaveProperty('videoDetails');
  });

  test('deletes a nested dotted-path key without touching siblings', () => {
    const obj = { playerResponse: { adPlacements: [1], videoDetails: { title: 'x' } } };
    expect(deleteNestedKey(obj, 'playerResponse.adPlacements')).toBe(true);
    expect(obj.playerResponse).not.toHaveProperty('adPlacements');
    expect(obj.playerResponse.videoDetails.title).toBe('x');
  });

  test('returns false when the path is absent, without throwing', () => {
    expect(deleteNestedKey({ videoDetails: {} }, 'adPlacements')).toBe(false);
    expect(deleteNestedKey({ videoDetails: {} }, 'playerResponse.adPlacements')).toBe(false);
  });

  test('returns false when an intermediate segment is missing or not an object', () => {
    expect(deleteNestedKey({}, 'playerResponse.adPlacements')).toBe(false);
    expect(deleteNestedKey({ playerResponse: null }, 'playerResponse.adPlacements')).toBe(false);
    expect(deleteNestedKey({ playerResponse: 'not-an-object' }, 'playerResponse.adPlacements')).toBe(false);
  });

  test('returns false for non-object input instead of throwing', () => {
    expect(deleteNestedKey(null, 'adPlacements')).toBe(false);
    expect(deleteNestedKey(42, 'adPlacements')).toBe(false);
  });
});

describe('pruneAdFields — strips ad-scheduling metadata before the player reads it', () => {
  test('prunes every known ad key present on a realistic player response', () => {
    const response = {
      videoDetails: { videoId: 'abc123', title: 'Some Track' },
      playabilityStatus: { status: 'OK' },
      adPlacements: [{ adPlacementRenderer: {} }],
      adSlots: [{}],
      playerAds: [{}],
      adBreakHeartbeatParams: 'xyz'
    };
    expect(pruneAdFields(response)).toBe(true);
    expect(response).not.toHaveProperty('adPlacements');
    expect(response).not.toHaveProperty('adSlots');
    expect(response).not.toHaveProperty('playerAds');
    expect(response).not.toHaveProperty('adBreakHeartbeatParams');
    // Untouched: pruning must not collaterally remove real content fields.
    expect(response.videoDetails.videoId).toBe('abc123');
    expect(response.playabilityStatus.status).toBe('OK');
  });

  test('prunes the playerResponse-wrapped shape used by /next and /browse', () => {
    const response = {
      playerResponse: {
        videoDetails: { videoId: 'abc123' },
        adPlacements: [{}],
        adBreakHeartbeatParams: 'xyz'
      }
    };
    expect(pruneAdFields(response)).toBe(true);
    expect(response.playerResponse).not.toHaveProperty('adPlacements');
    expect(response.playerResponse).not.toHaveProperty('adBreakHeartbeatParams');
    expect(response.playerResponse.videoDetails.videoId).toBe('abc123');
  });

  test('prunes the upsell dialog renderer at both known nesting depths', () => {
    const a = { auxiliaryUi: { messageRenderers: { upsellDialogRenderer: {} } } };
    const b = { playerResponse: { auxiliaryUi: { messageRenderers: { upsellDialogRenderer: {} } } } };
    expect(pruneAdFields(a)).toBe(true);
    expect(pruneAdFields(b)).toBe(true);
  });

  test('returns false and does nothing for a response with no ad-related fields', () => {
    const response = { videoDetails: { videoId: 'abc123' } };
    expect(pruneAdFields(response)).toBe(false);
    expect(response).toEqual({ videoDetails: { videoId: 'abc123' } });
  });

  test('is a no-op for non-object JSON.parse results (arrays, primitives, null)', () => {
    expect(pruneAdFields(null)).toBe(false);
    expect(pruneAdFields(42)).toBe(false);
    expect(pruneAdFields('a string')).toBe(false);
    expect(pruneAdFields([1, 2, 3])).toBe(false);
  });
});

describe('isAdResponseUrl', () => {
  test('matches every declared ad-scheduling endpoint', () => {
    for (const endpoint of AD_RESPONSE_ENDPOINTS) {
      expect(isAdResponseUrl(`https://music.youtube.com${endpoint}?prettyPrint=false`)).toBe(true);
    }
  });

  test('does not match unrelated endpoints', () => {
    expect(isAdResponseUrl('https://music.youtube.com/youtubei/v1/log_event')).toBe(false);
    expect(isAdResponseUrl('https://music.youtube.com/youtubei/v1/att/get')).toBe(false);
    expect(isAdResponseUrl('https://music.youtube.com/generate_204')).toBe(false);
  });
});

describe('banner sweep selector', () => {
  test('stays cheap: no :has(), which re-scans the document on every DOM mutation burst', () => {
    expect(BANNER_SELECTOR).not.toContain(':has(');
  });
});
