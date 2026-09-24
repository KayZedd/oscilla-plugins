# Oscilla plugins

Plugins for [YTMD](https://github.com/KayZedd/ytmd) (soon Oscilla), the
desktop client for YouTube Music, and the official signed registry YTMD
installs them from.

This folder is meant to be pushed as its own repository,
`KayZedd/oscilla-plugins`. YTMD has this registry built in:

- index: `https://kayzedd.github.io/oscilla-plugins/index.json`
- public key (also in `minisign.pub`, key id `2254F07B14D10D3E`):
  `RWQ+DdEUe/BUIiUnj3ovEvBOs/mbG7mVy+1yR0/0VqkAAKX/36+pTw34`

YTMD refuses anything that isn't signed with that key. Users can add other
registries in **Settings → Plugins → Registries** with their own address
and key.

| Plugin | What it does | Permissions |
|---|---|---|
| `app.ytmd.example-theme` | The smallest useful plugin: an accent color over YouTube Music | `ui` |
| `app.ytmd.adblock` | Removes ad scheduling from YouTube Music's responses; mutes, hides and skips what slips through | `player:read`, `page`, `ui` |
| `app.ytmd.downloader` | A player-bar button that saves the current song with yt-dlp (which the user installs) | `player:read`, `page`, `ui`, `media:save` |
| `app.ytmd.sponsorblock` | Skips intros, outros and other non-music parts using the SponsorBlock database | `player:read`, `player:control`, `network` (`sponsor.ajay.app`) |

The plugin API itself (manifest, permissions, the `ytmd` object) is
documented in YTMD's [`docs/PLUGIN_API.md`](https://github.com/KayZedd/ytmd/blob/main/docs/PLUGIN_API.md).

## Layout

```
plugins/<id>/manifest.json     what the plugin is and may do
plugins/<id>/main.js           its code (the manifest's "entry")
plugins/<id>/*.css             optional styles (the manifest's "styles")
plugins/<id>/*.test.ts         tests, never packed
scripts/build-index.ts         builds dist/: archives + index.json
.github/workflows/release.yml  on a tag: build, sign, publish to Pages
```

The folder name must be the plugin's `id`.

## Manifest

```json
{
  "id": "com.example.my-plugin",
  "name": "My plugin",
  "version": "1.2.0",
  "apiVersion": 1,
  "description": "One sentence users see before installing.",
  "author": "Your name",
  "homepage": "https://example.com/my-plugin",
  "matches": ["https://music.youtube.com/*"],
  "runAt": "document-idle",
  "permissions": ["player:read", "ui"],
  "hosts": [],
  "entry": "main.js",
  "styles": ["style.css"],
  "settings": [
    { "key": "enabled_feature", "type": "boolean", "label": { "en": "Do the thing", "pl": "Rób to" }, "default": true }
  ]
}
```

- `id`: reverse-DNS, lower case, also the folder name. Never change it.
- `version`: semver. YTMD installs updates automatically when the new
  version asks for **no** new permissions; otherwise the user is asked.
- `apiVersion`: `1`.
- `permissions`: any of `player:read`, `player:control`, `page`, `storage`,
  `network`, `ui`, `media:save`. `network` needs `hosts` (plain host names, https only).
- `runAt`: `document-start` (before YouTube Music's own scripts, e.g. to
  wrap `fetch`) or `document-idle` (default).
- `settings`: rendered in YTMD's Settings; types `boolean`, `number`
  (`min`/`max`), `string`, `select` (`options`). Labels are a string or
  `{ "en": ..., "pl": ... }`.

## Adding a plugin

1. Create `plugins/<id>/` with a manifest and the entry script. Plain
   JavaScript, no build step, no network access outside `hosts`, no native
   code. The entry script gets a `ytmd` object; see the example theme.
2. Export pure functions for tests with
   `if (typeof module !== 'undefined') module.exports = { ... }` and put
   `bun:test` tests next to it (`*.test.ts`, not packed).
3. `bun test && bun scripts/build-index.ts` locally.
4. Open a pull request. Review it like code that runs inside every user's
   YouTube Music session, because it does.
5. To publish, bump `version` in the manifest and push a tag (`v2026.09.24`).

## Signing key

The registry has its own minisign key, separate from YTMD's updater key.
The public half is `minisign.pub` and is built into YTMD
(`src-tauri/src/plugins/registry.rs`, `OFFICIAL_KEY`); changing it means
shipping a YTMD update first.

Once, when creating the repository:

- Store the full contents of the secret key file as the repository secret
  `MINISIGN_SECRET_KEY` and its password as `MINISIGN_PASSWORD`, then keep
  the file offline (or delete it). Never commit it.
- Enable GitHub Pages with "GitHub Actions" as the source.

A lost or leaked secret key: generate a new pair
(`minisign -G -p minisign.pub -s registry.key`), release YTMD with the new
`OFFICIAL_KEY`, then re-sign the registry with it.

## What the registry publishes

`index.json` (`format: 1`) lists for every plugin: `id`, `name`, `version`,
`apiVersion`, `description`, `author`, `permissions`, `url` of its
`.tar.gz`, and the archive's `sha256`. `index.json.minisig` signs the whole
index, so the checksums, and through them every archive, are covered by
the registry key. YTMD additionally checks that each archive's manifest
matches its index entry (id, version, permissions) before installing it.
