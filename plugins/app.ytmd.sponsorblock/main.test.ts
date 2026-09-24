import { describe, expect, test } from 'bun:test';

const { isFreshSegmentResponse, segmentToSkip, segmentsUrl } = require('./main.js');

describe('SponsorBlock: stale response guard', () => {
  test('accepts a response for the video that is still current', () => {
    expect(isFreshSegmentResponse('video-A', 'video-A')).toBe(true);
  });

  test('rejects a response for a video the user has already skipped past', () => {
    expect(isFreshSegmentResponse('video-A', 'video-B')).toBe(false);
  });
});

describe('SponsorBlock: which segment to skip', () => {
  const segs = [
    { category: 'intro', segment: [0, 10], UUID: 'a' },
    { category: 'outro', segment: [100, 120], UUID: 'b' }
  ];

  test('skips a segment once, so seeking back into it is possible', () => {
    const skipped = new Set<string>();
    expect(segmentToSkip(segs, 3, skipped)?.UUID).toBe('a');
    skipped.add('a');
    expect(segmentToSkip(segs, 3, skipped)).toBeNull();
  });

  test('leaves the last half second alone and ignores time outside segments', () => {
    expect(segmentToSkip(segs, 9.8, new Set())).toBeNull();
    expect(segmentToSkip(segs, 50, new Set())).toBeNull();
  });

  test('asks only the SponsorBlock API for the chosen categories', () => {
    const url = new URL(segmentsUrl('dQw4w9WgXcQ', ['intro']));
    expect(url.host).toBe('sponsor.ajay.app');
    expect(url.searchParams.get('categories')).toBe('["intro"]');
  });
});
