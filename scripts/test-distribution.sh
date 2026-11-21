#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

test_mac_app() {
  local bundle="$1"
  if [[ ${SVGX_EXPECT_NOTARIZED:-0} == 1 ]]; then
    codesign --verify --deep --strict --verbose=2 "$bundle"
    local signature
    signature="$(codesign --display --verbose=4 "$bundle" 2>&1)"
    grep -Fx "TeamIdentifier=${APPLE_TEAM_ID:?}" <<< "$signature"
    grep -E '^Authority=Developer ID Application: ' <<< "$signature"
    grep -E '^CodeDirectory .*flags=.*\([^)]*runtime' <<< "$signature"
    xcrun stapler validate "$bundle"
    spctl --assess --type execute --verbose=2 "$bundle"
  fi
  SVGX_PACKAGE_EXE="$bundle/Contents/MacOS/SVG-X" npm run test:e2e:package
}

case "$(uname -s)" in
  Linux)
    appimages=(release/*.AppImage)
    packages=(release/*.deb)
    if [[ ${#appimages[@]} != 1 || ${#packages[@]} != 1 ]]; then
      echo "Expected one AppImage and one DEB in release/" >&2
      exit 1
    fi
    sha256sum "${appimages[0]}" "${packages[0]}"
    env -u APPIMAGE_EXTRACT_AND_RUN SVGX_NATIVE_BATCH=0 SVGX_TEST_LAN=0 \
      SVGX_PACKAGE_EXE="${appimages[0]}" npm run test:e2e:package

    deb="$(realpath "${packages[0]}")"
    package="$(dpkg-deb --field "$deb" Package)"
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q ' installed$'; then
      echo "Use a test system without an existing $package installation" >&2
      exit 1
    fi
    dpkg-deb --field "$deb" Package Version Architecture Maintainer Homepage
    trap 'sudo apt-get purge -y "$package"' EXIT
    sudo apt-get install -y --no-install-recommends "$deb"
    executable="$(dpkg-query -L "$package" | awk '/^\/opt\/.*\/svg-x$/')"
    test -x "$executable"
    launcher=/usr/share/applications/svg-x.desktop
    grep -Fx 'StartupWMClass=svg-x' "$launcher"
    SVGX_PACKAGE_EXE="$executable" npm run test:e2e:package
    sudo apt-get purge -y "$package"
    trap - EXIT
    test ! -e "$executable"
    test ! -e "$launcher"
    ;;
  Darwin)
    disks=(release/*.dmg)
    archives=(release/*.zip)
    if [[ ${#disks[@]} != 1 || ${#archives[@]} != 1 ]]; then
      echo "Expected one DMG and one ZIP in release/" >&2
      exit 1
    fi
    shasum -a 256 "${disks[0]}" "${archives[0]}"
    work="$(mktemp -d)"
    mounted=0
    cleanup() {
      if [[ $mounted == 1 ]]; then
        hdiutil detach "$work/mount" || return
      fi
      rm -rf -- "$work"
    }
    trap cleanup EXIT
    mkdir "$work/mount"
    hdiutil attach "${disks[0]}" -nobrowse -readonly -mountpoint "$work/mount"
    mounted=1
    ditto "$work/mount/SVG-X.app" "$work/from-dmg/SVG-X.app"
    hdiutil detach "$work/mount"
    mounted=0
    test_mac_app "$work/from-dmg/SVG-X.app"

    ditto -x -k "${archives[0]}" "$work/from-zip"
    test_mac_app "$work/from-zip/SVG-X.app"
    ;;
  *)
    echo "Use this distribution test on Linux or macOS" >&2
    exit 1
    ;;
esac
