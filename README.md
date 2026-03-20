# AUR Cursor pre-release updater

GitHub Actions workflows that track Cursor’s **early access** and **nightly** Linux builds and publish matching AUR packages.

> [!NOTE]
> **In scope:** `cursor-early-access-bin` and `cursor-nightly-bin` on the AUR.  
> **Out of scope:** stable-channel Cursor packaging (see the AUR for community options).

## Installing

```bash
# Early access
paru -S cursor-early-access-bin

# Nightly
paru -S cursor-nightly-bin
```

Only one `provides=('cursor')` Cursor package should be installed at a time. These builds **conflict** with `cursor-bin`, [`cursor-ide-bin`](https://aur.archlinux.org/packages/cursor-ide-bin), and the sibling channel package (early access vs nightly).

For **stable** Cursor on Arch, pick an AUR package deliberately: `cursor-bin` (and similar) historically **substitute** system Electron/Node, while [`cursor-ide-bin`](https://aur.archlinux.org/packages/cursor-ide-bin) keeps the **bundled** runtime—closer to what this repository does for pre-release channels.

## Repository Layout

| File | Purpose |
|------|---------|
| `.github/workflows/update-aur-early-access.yml` | Publishes `cursor-early-access-bin` |
| `.github/workflows/update-aur-nightly.yml` | Publishes `cursor-nightly-bin` |
| `PKGBUILD.early-access.sed` | Early access PKGBUILD template |
| `PKGBUILD.nightly.sed` | Nightly PKGBUILD template |
| `cursor.desktop` | Desktop entry (copied to the AUR repo next to the PKGBUILD) |
| `cursor-launcher.sh` | `/usr/bin/cursor` wrapper; runs bundled Electron (same) |

## How Updates Work

1. Workflow runs hourly (or manual dispatch).
2. It reads current package version/commit from tracked channel PKGBUILD files.
3. It queries Cursor update API for the channel track:
   - early access -> `prerelease`
   - nightly -> `dev`
4. It renders the channel `PKGBUILD` from the matching `.sed` template (version, commit, `.deb` checksum).
5. On `main`, it publishes to the AUR: the `PKGBUILD` plus `cursor.desktop` and `cursor-launcher.sh` as extra sources.
6. On `development`, it stops before AUR publish.

Channel `PKGBUILD` files are tracked in git for audit history:
- `PKGBUILD.early-access`
- `PKGBUILD.nightly`

## Monitoring

- [cursor-early-access-bin](https://aur.archlinux.org/packages/cursor-early-access-bin)
- [cursor-nightly-bin](https://aur.archlinux.org/packages/cursor-nightly-bin)
- GitHub Actions workflow runs

## Packaging approach

These packages install the official `.deb` **without** swapping in system Electron or Node (unlike typical `cursor-bin`-style packaging). That matches upstream’s tested runtime, avoids subtle breakage, and keeps process monitoring sane—aligned with [cursor-ide-bin](https://github.com/lone-cloud/cursor-ide-bin) / [`cursor-ide-bin` (AUR)](https://aur.archlinux.org/packages/cursor-ide-bin).

- **Runtime**: Electron and Node come from the upstream bundle; `ripgrep` is no longer replaced by a wrapper script (`rg.sh` was removed).
- **Build**: `imagemagick` trims the pixmap icon; `chrome-sandbox` is set setuid when present.
- **Flags**: optional Chromium/Electron flags via `~/.config/cursor-flags.conf` (one flag per line; see `cursor-launcher.sh`).
- **License file**: the PKGBUILD installs `LICENSE.txt` from the usual path inside the `.deb`, or searches under `/usr/share/cursor` if it moves; if none is found, the build warns and continues.

## Inspiration

This repository is **not** a straight fork of either project below; it **combines** ideas from both:

- **[lone-cloud/cursor-ide-bin](https://github.com/lone-cloud/cursor-ide-bin)** — bundled Electron, `.desktop` + launcher (`cursor-flags.conf`), ImageMagick icon trim, dependency set, and general “ship the `.deb` as upstream built it” philosophy.
- **[Gunther-Schulz/aur-cursor-bin-updater](https://github.com/Gunther-Schulz/aur-cursor-bin-updater)** — automated PKGBUILD updates driven by Cursor’s API (a pattern this repo still uses for **channel** tracking). The **pre-release** packages here intentionally **do not** follow the system-`electron` split still common in `cursor-bin`-style recipes.

Neither project above is responsible for this repo’s packages; mistakes or policy choices here are ours.
