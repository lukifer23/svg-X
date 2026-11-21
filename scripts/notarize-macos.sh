#!/usr/bin/env bash
set -euo pipefail

for name in CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY_BASE64 APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_TEAM_ID; do
  if [[ -z ${!name:-} ]]; then
    echo "Missing macOS signing configuration: $name" >&2
    exit 1
  fi
done

umask 077
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
export APPLE_API_KEY="$work/AuthKey.p8"
printf '%s' "$APPLE_API_KEY_BASE64" | base64 -D > "$APPLE_API_KEY"
unset APPLE_API_KEY_BASE64

# The builder signs and staples the app before generating its DMG and ZIP.
npm exec --no -- electron-builder --mac --publish never \
  -c.forceCodeSigning=true -c.mac.hardenedRuntime=true \
  -c.mac.notarize=true -c.dmg.sign=true

unset CSC_LINK CSC_KEY_PASSWORD
shopt -s nullglob
disks=(release/*.dmg)
if [[ ${#disks[@]} != 1 ]]; then
  echo "Expected exactly one DMG for notarization" >&2
  exit 1
fi
dmg="${disks[0]}"
auth=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
codesign --verify --verbose=2 "$dmg"
identity="$(codesign --display --verbose=4 "$dmg" 2>&1)"
grep -Fx "TeamIdentifier=$APPLE_TEAM_ID" <<< "$identity"
grep -E '^Authority=Developer ID Application: ' <<< "$identity"

result="$work/notary-result.json"
status=0
xcrun notarytool submit "$dmg" "${auth[@]}" --wait --timeout 20m \
  --output-format json > "$result" || status=$?
submission="$(plutil -extract id raw -o - "$result" 2>/dev/null || true)"
decision="$(plutil -extract status raw -o - "$result" 2>/dev/null || true)"
if [[ $status != 0 || $decision != Accepted || -z $submission ]]; then
  if [[ -n $submission ]]; then
    xcrun notarytool log "$submission" "${auth[@]}" >&2 || true
  fi
  echo "DMG notarization did not succeed (id=${submission:-unavailable}, status=${decision:-unavailable})" >&2
  exit 1
fi
echo "Apple accepted DMG notarization $submission"
xcrun notarytool log "$submission" "${auth[@]}"
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
rm -f -- "$APPLE_API_KEY"
unset APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
SVGX_EXPECT_NOTARIZED=1 bash scripts/test-distribution.sh
