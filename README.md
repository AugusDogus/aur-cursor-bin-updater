# AUR Cursor Pre-release Package Updater

Automated maintenance for Cursor pre-release AUR packages.

> [!IMPORTANT]
> This fork only maintains:
> - `cursor-early-access-bin`
> - `cursor-nightly-bin`
>
> Stable `cursor-bin` is maintained upstream by:
> [Gunther-Schulz/aur-cursor-bin-updater](https://github.com/Gunther-Schulz/aur-cursor-bin-updater)

## Installing

```bash
# Early access
yay -S cursor-early-access-bin

# Nightly
yay -S cursor-nightly-bin
```

For stable `cursor-bin`, use the upstream package/repository.

## Repository Layout

| File | Purpose |
|------|---------|
| `.github/workflows/update-aur-early-access.yml` | Publishes `cursor-early-access-bin` |
| `.github/workflows/update-aur-nightly.yml` | Publishes `cursor-nightly-bin` |
| `PKGBUILD.early-access.sed` | Early access PKGBUILD template |
| `PKGBUILD.nightly.sed` | Nightly PKGBUILD template |
| `rg.sh` | ripgrep wrapper included in package assets |

## How Updates Work

1. Workflow runs hourly (or manual dispatch).
2. It reads current package version/commit from tracked channel PKGBUILD files.
3. It queries Cursor update API for the channel track:
   - early access -> `prerelease`
   - nightly -> `dev`
4. It renders PKGBUILD from template with latest version/commit/checksum.
5. On `main`, it publishes to AUR.
6. On `development`, it stops before AUR publish.

Channel `PKGBUILD` files are tracked in git for audit history:
- `PKGBUILD.early-access`
- `PKGBUILD.nightly`

## Monitoring

- [cursor-early-access-bin](https://aur.archlinux.org/packages/cursor-early-access-bin)
- [cursor-nightly-bin](https://aur.archlinux.org/packages/cursor-nightly-bin)
- GitHub Actions workflow runs

## Related

- [Cursor IDE](https://www.cursor.com)
- [AUR submission guidelines](https://wiki.archlinux.org/title/AUR_submission_guidelines)
