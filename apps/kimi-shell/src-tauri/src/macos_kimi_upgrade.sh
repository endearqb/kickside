set -euo pipefail

version="$1"
kimi_path="$2"
binary_base_url="$3"
case "$(uname -m)" in
  arm64|aarch64) target="darwin-arm64" ;;
  x86_64|amd64) target="darwin-x64" ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

manifest="$(/usr/bin/curl --fail --location --silent --show-error "$binary_base_url/$version/manifest.json")"
one_line="$(printf '%s' "$manifest" | tr -d '\n\r\t')"
if [[ $one_line =~ \"$target\"[^}]*\"filename\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
  filename="${BASH_REMATCH[1]}"
else
  echo "Official manifest does not contain $target filename" >&2
  exit 1
fi
if [[ $one_line =~ \"$target\"[^}]*\"checksum\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
  checksum="${BASH_REMATCH[1]}"
else
  echo "Official manifest does not contain $target checksum" >&2
  exit 1
fi
case "$filename" in
  ''|*/*|*\\*) echo "Official manifest returned an invalid filename" >&2; exit 1 ;;
esac
case "$checksum" in
  *[!0-9a-f]*|'') echo "Official manifest returned an invalid checksum" >&2; exit 1 ;;
esac
[ "${#checksum}" -eq 64 ] || { echo "Official manifest returned an invalid checksum" >&2; exit 1; }

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/kimi-sidekick-upgrade.XXXXXX")"
staged=""
backup=""
backup_created=0
committed=0
cleanup() {
  rm -rf "$tmp_dir"
  [ -z "$staged" ] || rm -f "$staged"
  if [ "$committed" -ne 1 ] && [ "$backup_created" -eq 1 ] && [ -n "$backup" ] && [ -f "$backup" ]; then
    /bin/mv -f "$backup" "$kimi_path"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
download="$tmp_dir/kimi"
/usr/bin/curl --fail --location --silent --show-error -o "$download" "$binary_base_url/$version/$filename"
actual="$(/usr/bin/shasum -a 256 "$download" | /usr/bin/awk '{print $1}')"
if [ "$actual" != "$checksum" ]; then
  echo "Kimi Code checksum mismatch" >&2
  exit 1
fi
/bin/chmod 0755 "$download"
downloaded_version="$("$download" --version)"
case "$downloaded_version" in
  *"$version"*) ;;
  *) echo "Downloaded Kimi Code version mismatch: $downloaded_version" >&2; exit 1 ;;
esac

parent="$(/usr/bin/dirname "$kimi_path")"
/bin/mkdir -p "$parent"
backup="$kimi_path.bak"
if [ -f "$kimi_path" ]; then
  /bin/cp -p "$kimi_path" "$backup"
  backup_created=1
fi
staged="$parent/.kimi-sidekick-upgrade.$$.new"
/usr/bin/install -m 0755 "$download" "$staged"
/bin/mv -f "$staged" "$kimi_path"
staged=""
committed=1
echo "Installed Kimi Code $version to $kimi_path"
