import { describe, expect, test } from 'bun:test';

const { errorMessage, progressMessage, isFinal, text, needsTools, missingToolsMessage, installMessage } = require('./main.js');

describe('Downloader: installing yt-dlp and ffmpeg', () => {
  test('offers the install only for missing tools', () => {
    expect(needsTools('plugins.error.ytdlpMissing')).toBe(true);
    expect(needsTools('plugins.error.ffmpegMissing')).toBe(true);
    expect(needsTools('plugins.error.mediaFailed:ERROR: x')).toBe(false);
    const all = { ytdlp: 'system', ffmpeg: 'managed', ytdlpVersion: null, installable: true, installing: false };
    expect(missingToolsMessage('en', all)).toBeNull();
    expect(missingToolsMessage('en', { ...all, ytdlp: 'missing' })).toBe('Saving songs needs yt-dlp and ffmpeg.');
    expect(missingToolsMessage('pl', { ...all, ffmpeg: 'missing' })).toBe('Do zapisywania utworów potrzebny jest ffmpeg.');
  });

  test('progress text', () => {
    expect(installMessage('en', { state: 'downloading', tool: 'ffmpeg', percent: 41.6, error: null })).toBe('Installing ffmpeg… 42%');
    expect(installMessage('pl', { state: 'installing', tool: 'ffmpeg', percent: 99, error: null })).toBe('Kończenie instalacji…');
  });
});

describe('Downloader: messages', () => {
  test('follows YouTube Music’s language, English otherwise', () => {
    expect(text('pl-PL', 'save')).toBe('Zapisz ten utwór');
    expect(text('en-GB', 'save')).toBe('Save this song');
    expect(text('', 'save')).toBe('Save this song');
    expect(text('de', 'save')).toBe('Save this song');
  });

  test('explains the errors YTMD reports', () => {
    expect(errorMessage('en', 'plugins.error.ytdlpMissing')).toBe('Saving songs needs yt-dlp and ffmpeg.');
    expect(errorMessage('pl', 'plugins.error.ffmpegMissing')).toBe('Do zapisywania utworów potrzebny jest ffmpeg.');
    expect(errorMessage('pl', 'plugins.error.busy')).toContain('Spróbuj za chwilę');
    expect(errorMessage('en', 'plugins.error.mediaFolder:Permission denied')).toContain('Settings → Plugins');
    expect(errorMessage('en', 'plugins.error.mediaFailed:ERROR: Video unavailable')).toBe(
      'Couldn’t save the song: Video unavailable'
    );
    expect(errorMessage('en', 'plugins.error.mediaFailed')).toBe('Couldn’t save the song');
  });

  test('a toast only at the end of a job', () => {
    const base = { plugin: 'app.ytmd.downloader', job: 'j', videoId: 'dQw4w9WgXcQ', percent: 0, file: null, error: null };
    expect(progressMessage('en', { ...base, state: 'downloading' })).toBeNull();
    expect(progressMessage('en', { ...base, state: 'done', file: 'Queen - Song.mp3' })).toBe('Saved Queen - Song.mp3');
    expect(progressMessage('pl', { ...base, state: 'cancelled' })).toBe('Przerwano zapisywanie');
    expect(isFinal('converting')).toBe(false);
    expect(isFinal('failed')).toBe(true);
  });
});
