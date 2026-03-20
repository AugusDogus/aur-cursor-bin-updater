# Maintainer: AugusDogus <augie@linux.com>

pkgname=cursor-nightly-bin
pkgver=
_upstream_pkgver=
pkgrel=2
pkgdesc='AI-first coding environment (nightly channel, bundled Electron)'
arch=('x86_64')
url="https://www.cursor.com"
license=('LicenseRef-Cursor_EULA')
provides=('cursor')
conflicts=('cursor-bin' 'cursor-early-access-bin' 'cursor-nightly-bin' 'cursor-ide-bin')
makedepends=('imagemagick')
depends=(
  'alsa-lib'
  'dbus'
  'gcc-libs'
  'gtk3'
  'libdrm'
  'libsecret'
  'libxkbfile'
  'mesa'
  'nss'
  'xdg-utils'
)
optdepends=(
  'libnotify: desktop notifications'
  'org.freedesktop.secrets: credential storage via SecretService'
  'libdbusmenu-glib: KDE global menu support'
)
options=(!strip !debug)
_commit=
source=(
  "cursor_${_upstream_pkgver}_amd64.deb::https://downloads.cursor.com/production/${_commit}/linux/x64/deb/amd64/deb/cursor_${_upstream_pkgver}_amd64.deb"
  cursor.desktop
  cursor-launcher.sh
)
sha512sums=('SKIP'
  '008c71cc0c4afec88ebfb177a6f40e3d178db9b622bec520c73c548a94cb674a5bd1b9f2f2a4329775183ca7a7a3ca65cb37a28c5d4d2667b1d65ee9342c54f0'
  '8757c1e18b3140d690c87ad5fdaf74fa7d5c9075016ef32eed7b5cd814e16453d0db36899b6f3562322b823ddab18c9be7104958d25fee732e30f4f2eb481330')
sha512sums[0]=
noextract=("cursor_${_upstream_pkgver}_amd64.deb")

package() {
  # Extract full deb — keep bundled Electron intact.
  bsdtar -xOf "cursor_${_upstream_pkgver}_amd64.deb" data.tar.xz |
    tar -xJf - -C "$pkgdir"

  # Fix zsh completion path for Arch
  if [[ -d "$pkgdir/usr/share/zsh/vendor-completions" ]]; then
    mv "$pkgdir/usr/share/zsh/vendor-completions" \
       "$pkgdir/usr/share/zsh/site-functions"
  fi

  install -Dm644 "$srcdir/cursor.desktop" \
    "$pkgdir/usr/share/applications/cursor.desktop"

  if [[ -f "$pkgdir/usr/share/pixmaps/co.anysphere.cursor.png" ]]; then
    magick "$pkgdir/usr/share/pixmaps/co.anysphere.cursor.png" \
      -trim +repage -resize 1024x1024 \
      "$pkgdir/usr/share/pixmaps/cursor.png"
    chmod 644 "$pkgdir/usr/share/pixmaps/cursor.png"
    rm "$pkgdir/usr/share/pixmaps/co.anysphere.cursor.png"
  fi

  install -Dm755 "$srcdir/cursor-launcher.sh" "$pkgdir/usr/bin/cursor"

  install -Dm644 "$pkgdir/usr/share/cursor/resources/app/LICENSE.txt" \
    "$pkgdir/usr/share/licenses/$pkgname/LICENSE"

  if [[ -f "$pkgdir/usr/share/cursor/chrome-sandbox" ]]; then
    chmod 4755 "$pkgdir/usr/share/cursor/chrome-sandbox"
  fi
}
