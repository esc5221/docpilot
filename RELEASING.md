# Releasing docpilot

Builds run in GitHub Actions on a **macOS (arm64)** and **Windows (x64)** runner
and publish a **draft GitHub Release** with installers + auto-update metadata.

## Cut a release

```bash
# bump version in app/src-tauri/tauri.conf.json + app/package.json first
git tag v0.1.0
git push origin v0.1.0
```

The `release` workflow builds both platforms, uploads:

- macOS: `docpilot_<v>_aarch64.dmg` (+ `.app.tar.gz` + `.sig` for the updater)
- Windows: `docpilot_<v>_x64-setup.exe` (+ `.msi` + `.sig`)
- `latest.json` (auto-update manifest)

Publish the draft release to make it live. Auto-update reads `latest.json` from
the **latest** release, so users on older versions get prompted in-app.

## Required GitHub secrets

### Updater signing (required — without it the build fails)

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.docpilot-keys/docpilot.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""   # key was made with no password
```

> The matching **public** key already lives in `tauri.conf.json` → `plugins.updater.pubkey`.
> Keep `~/.docpilot-keys/docpilot.key` safe — losing it breaks future auto-updates.

### macOS code signing + notarization (optional, but chosen for this project)

Without these, the macOS build is **unsigned** — it still installs, but users
must right-click → Open (Gatekeeper). Add them to ship notarized:

```bash
gh secret set APPLE_CERTIFICATE --body "<base64 of your Developer ID .p12>"
gh secret set APPLE_CERTIFICATE_PASSWORD --body "<.p12 password>"
gh secret set APPLE_SIGNING_IDENTITY --body "Developer ID Application: NAME (TEAMID)"
gh secret set APPLE_ID --body "<your Apple ID email>"
gh secret set APPLE_PASSWORD --body "<app-specific password>"
gh secret set APPLE_TEAM_ID --body "<TEAMID>"
```

- `.p12`: export your "Developer ID Application" cert from Keychain, then
  `base64 -i cert.p12 | pbcopy`.
- `APPLE_PASSWORD`: an app-specific password from appleid.apple.com (not your login).

Windows is shipped **unsigned** (SmartScreen shows "unknown publisher"; users
click *More info → Run anyway*). Add a code-signing cert later if desired.

## What users need

docpilot uses the user's **own** Codex (ChatGPT subscription) — it is not
bundled. On first run the in-app banner guides them to:

1. install Codex CLI if missing (`npm i -g @openai/codex`), and
2. **Sign in with ChatGPT** (runs `codex login`).

The app bundles its own Node runtime and the document engine, so nothing else
is required.

## Local build (unsigned, for testing)

```bash
cd sidecar && npm install && npm run build
cd .. && node scripts/stage-sidecar.mjs
# place a self-contained node binary:
#   app/src-tauri/binaries/node-aarch64-apple-darwin   (from nodejs.org, not Homebrew)
cd app && npm install && npx tauri build
```
