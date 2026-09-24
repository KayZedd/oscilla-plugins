// Downloader for Oscilla (plugin API 1): a player-bar button that saves the
// current song with `ytmd.media.save` (the media:save permission). Oscilla
// runs yt-dlp with a fixed command line into the folder the user chose in
// Settings → Plugins; this plugin only says which song and which format.
// When yt-dlp or ffmpeg is missing it offers to install them: Oscilla asks the
// user in its own dialog, downloads them from their GitHub releases and
// checks their checksums; then the song is saved.

var ICON_SAVE = 'M5 20h14v-2H5v2zm7-18v10.17l-3.59-3.58L7 10l5 5 5-5-1.41-1.41L13 12.17V2h-2z';
var ICON_STOP = 'M6 6h12v12H6z';

var TEXT = {
  en: {
    save: 'Save this song',
    cancel: 'Stop saving',
    queued: 'Waiting to save…',
    started: 'Saving “{title}”…',
    done: 'Saved {file}',
    cancelled: 'Stopped saving',
    failed: 'Couldn’t save the song',
    noSong: 'Nothing to save yet: play a song first',
    ytdlpMissing: 'Saving songs needs yt-dlp and ffmpeg.',
    ffmpegMissing: 'Saving songs needs ffmpeg.',
    install: 'Install',
    installing: 'Installing {tool}… {percent}%',
    installingFinish: 'Finishing the install…',
    installed: 'yt-dlp and ffmpeg are ready',
    installFailed: 'Couldn’t install yt-dlp and ffmpeg. Check your connection and try again.',
    unsupported: 'Oscilla can’t install yt-dlp and ffmpeg on this system; install them yourself.',
    busy: 'Too many songs are being saved. Try again in a moment.',
    folder: 'Couldn’t write to the folder for saved songs (Settings → Plugins)'
  },
  pl: {
    save: 'Zapisz ten utwór',
    cancel: 'Przerwij zapisywanie',
    queued: 'Czeka na zapisanie…',
    started: 'Zapisywanie „{title}”…',
    done: 'Zapisano {file}',
    cancelled: 'Przerwano zapisywanie',
    failed: 'Nie udało się zapisać utworu',
    noSong: 'Nie ma czego zapisać: najpierw włącz utwór',
    ytdlpMissing: 'Do zapisywania utworów potrzebne są yt-dlp i ffmpeg.',
    ffmpegMissing: 'Do zapisywania utworów potrzebny jest ffmpeg.',
    install: 'Zainstaluj',
    installing: 'Instalowanie {tool}… {percent}%',
    installingFinish: 'Kończenie instalacji…',
    installed: 'yt-dlp i ffmpeg są gotowe',
    installFailed: 'Nie udało się zainstalować yt-dlp i ffmpeg. Sprawdź połączenie i spróbuj ponownie.',
    unsupported: 'Oscilla nie może zainstalować yt-dlp i ffmpeg w tym systemie; zainstaluj je samodzielnie.',
    busy: 'Zapisuje się zbyt wiele utworów. Spróbuj za chwilę.',
    folder: 'Nie można zapisać w folderze na zapisane utwory (Ustawienia → Wtyczki)'
  }
};

function language(lang) {
  return String(lang || '').toLowerCase().indexOf('pl') === 0 ? 'pl' : 'en';
}

function text(lang, key, vars) {
  var s = TEXT[language(lang)][key] || TEXT.en[key] || key;
  for (var k in vars || {}) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

/** What to tell the user about an error key from Oscilla
 * (`plugins.error.…`, optionally followed by `:detail`). */
function errorMessage(lang, error) {
  var key = String(error || '');
  var detail = '';
  var colon = key.indexOf(':');
  if (colon > 0) {
    detail = key.slice(colon + 1).trim();
    key = key.slice(0, colon);
  }
  if (key === 'plugins.error.ytdlpMissing') return text(lang, 'ytdlpMissing');
  if (key === 'plugins.error.ffmpegMissing') return text(lang, 'ffmpegMissing');
  if (key === 'plugins.error.busy') return text(lang, 'busy');
  if (key === 'plugins.error.mediaFolder') return text(lang, 'folder');
  var base = text(lang, 'failed');
  return detail ? base + ': ' + detail.replace(/^ERROR:\s*/, '') : base;
}

/** The toast for a progress event, or null for none. */
function progressMessage(lang, progress) {
  switch (progress.state) {
    case 'done':
      return text(lang, 'done', { file: progress.file || '' });
    case 'failed':
      return errorMessage(lang, progress.error);
    case 'cancelled':
      return text(lang, 'cancelled');
    default:
      return null;
  }
}

function isFinal(state) {
  return state === 'done' || state === 'failed' || state === 'cancelled';
}

/** Errors the Install button can fix. */
function needsTools(error) {
  var key = String(error || '').split(':')[0];
  return key === 'plugins.error.ytdlpMissing' || key === 'plugins.error.ffmpegMissing';
}

/** The missing-tools message for a status from `ytmd.media.tools()`, or
 * null when everything is there. */
function missingToolsMessage(lang, status) {
  if (!status) return null;
  if (status.ytdlp === 'missing') return text(lang, 'ytdlpMissing');
  if (status.ffmpeg === 'missing') return text(lang, 'ffmpegMissing');
  return null;
}

/** The toast while tools install. */
function installMessage(lang, progress) {
  if (progress.state === 'installing') return text(lang, 'installingFinish');
  return text(lang, 'installing', { tool: progress.tool || 'yt-dlp', percent: Math.round(progress.percent || 0) });
}

function start(ytmd) {
  var doc = ytmd.page.document;
  var lang = function () {
    return doc.documentElement.lang;
  };
  var job = null; // { id, videoId }
  var button = null;
  var mountTimer = null;

  function icon(path) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var p = doc.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    return svg;
  }

  function render(percent) {
    if (!button) return;
    var busy = job !== null;
    var label = text(lang(), busy ? 'cancel' : 'save');
    button.dataset.state = busy ? 'busy' : 'idle';
    button.setAttribute('aria-label', label);
    button.setAttribute('data-ytmd-tooltip', label);
    button.style.setProperty('--ytmd-dl-progress', String(busy ? percent || 0 : 0));
    button.replaceChildren(icon(busy ? ICON_STOP : ICON_SAVE));
  }

  // Installing yt-dlp/ffmpeg: Oscilla asks the user first, in its own dialog.
  var installing = false;
  ytmd.media.onToolsProgress(function (p) {
    if (!installing || p.state === 'done' || p.state === 'failed' || p.state === 'declined') return;
    ytmd.ui.toast(installMessage(lang(), p), { id: 'tools', durationMs: 60000 });
  });

  function install(then) {
    if (installing) return;
    installing = true;
    ytmd.media
      .installTools()
      .then(function (result) {
        installing = false;
        if (result === 'done') {
          ytmd.ui.toast(text(lang(), 'installed'), { id: 'tools' });
          if (then) then();
        } else if (result === 'failed') {
          ytmd.ui.toast(text(lang(), 'installFailed'), { id: 'tools', durationMs: 10000 });
        }
      })
      .catch(function () {
        installing = false;
        ytmd.ui.toast(text(lang(), 'installFailed'), { id: 'tools', durationMs: 10000 });
      });
  }

  /** A toast that explains what's missing, with an Install button. */
  function offerInstall(message, status, then) {
    if (status && status.installable === false) {
      ytmd.ui.toast(message + ' ' + text(lang(), 'unsupported'), { durationMs: 10000 });
      return;
    }
    ytmd.ui.toast(message, {
      id: 'tools',
      durationMs: 20000,
      action: {
        label: text(lang(), 'install'),
        onClick: function () {
          install(then);
        }
      }
    });
  }

  function onClick() {
    if (job) {
      ytmd.media.cancel(job.id).catch(function () {});
      return;
    }
    var track = ytmd.player.getTrack();
    if (!track || !track.videoId) {
      ytmd.ui.toast(text(lang(), 'noSong'));
      return;
    }
    ytmd.media
      .tools()
      .then(function (status) {
        var missing = missingToolsMessage(lang(), status);
        if (missing) offerInstall(missing, status, onClick);
        else saveTrack(track);
      })
      .catch(function () {
        saveTrack(track);
      });
  }

  function saveTrack(track) {
    var format = ytmd.settings.get('format') || 'mp3';
    job = { id: '', videoId: track.videoId };
    render(0);
    ytmd.media
      .save(track.videoId, { format: format })
      .then(function (id) {
        if (job && job.videoId === track.videoId && job.id === '') job.id = id;
        ytmd.ui.toast(text(lang(), 'started', { title: track.title }));
      })
      .catch(function (e) {
        job = null;
        render(0);
        var error = e && e.message ? e.message : e;
        if (needsTools(error)) offerInstall(errorMessage(lang(), error), null, onClick);
        else ytmd.ui.toast(errorMessage(lang(), error));
      });
  }

  // Our own button in the player bar's right-hand controls; YouTube Music
  // re-renders the bar now and then, so it's put back when it goes missing.
  function mount() {
    if (button && doc.contains(button)) return;
    var host = doc.querySelector('ytmusic-player-bar .right-controls-buttons');
    if (!host) return;
    button = doc.createElement('button');
    button.type = 'button';
    button.className = 'ytmd-dl-button';
    button.addEventListener('click', onClick);
    host.insertBefore(button, host.firstChild);
    render(0);
  }

  ytmd.media.onProgress(function (p) {
    if (!job || (job.id && p.job !== job.id) || (!job.id && p.videoId !== job.videoId)) return;
    if (!job.id) job.id = p.job;
    if (isFinal(p.state)) {
      job = null;
      render(0);
      var message = progressMessage(lang(), p);
      if (p.state === 'failed' && needsTools(p.error)) offerInstall(message, null, onClick);
      else if (message) ytmd.ui.toast(message);
      return;
    }
    render(p.percent);
  });

  mount();
  mountTimer = setInterval(mount, 2000);
  ytmd.onUnload(function () {
    clearInterval(mountTimer);
    if (job && job.id) ytmd.media.cancel(job.id).catch(function () {});
    if (button) button.remove();
    button = null;
  });
}

if (typeof ytmd !== 'undefined') {
  start(ytmd);
}

if (typeof module !== 'undefined') {
  module.exports = {
    errorMessage: errorMessage,
    progressMessage: progressMessage,
    isFinal: isFinal,
    text: text,
    needsTools: needsTools,
    missingToolsMessage: missingToolsMessage,
    installMessage: installMessage
  };
}
