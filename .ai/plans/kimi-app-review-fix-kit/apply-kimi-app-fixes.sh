#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./apply-kimi-app-fixes.sh /path/to/kimi-app [check|patch|write] [patch-path] [--allow-other-revision]

Examples:
  ./apply-kimi-app-fixes.sh ~/src/kimi-app check
  ./apply-kimi-app-fixes.sh ~/src/kimi-app patch /tmp/kimi-app-review-fixes.patch
  ./apply-kimi-app-fixes.sh ~/src/kimi-app write
  ./apply-kimi-app-fixes.sh ~/src/kimi-app patch --allow-other-revision
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

repo=$1
shift
mode=check
patch_path=
allow_other=false

if [[ $# -gt 0 && $1 != --* ]]; then
  mode=$1
  shift
fi
if [[ $mode == patch && $# -gt 0 && $1 != --* ]]; then
  patch_path=$1
  shift
fi
while [[ $# -gt 0 ]]; do
  case $1 in
    --allow-other-revision)
      allow_other=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fixer="$script_dir/apply_fixes.py"

if [[ ! -d $repo ]]; then
  echo "Repository directory does not exist: $repo" >&2
  exit 2
fi
if [[ ! -f $fixer ]]; then
  echo "apply_fixes.py not found: $fixer" >&2
  exit 2
fi

python_bin=${PYTHON:-}
if [[ -z $python_bin ]]; then
  if command -v python3 >/dev/null 2>&1; then
    python_bin=python3
  elif command -v python >/dev/null 2>&1; then
    python_bin=python
  else
    echo "Python 3 was not found." >&2
    exit 2
  fi
fi

args=("$fixer" --repo "$repo")
if $allow_other; then
  args+=(--allow-other-revision)
fi

case $mode in
  check)
    ;;
  patch)
    if [[ -z $patch_path ]]; then
      patch_path="$(cd -- "$(dirname -- "$repo")" && pwd)/kimi-app-review-fixes.patch"
    fi
    args+=(--patch-output "$patch_path")
    ;;
  write)
    args+=(--write)
    ;;
  *)
    echo "Unknown mode: $mode" >&2
    usage
    exit 2
    ;;
esac

"$python_bin" "${args[@]}"

if [[ $mode == patch ]]; then
  git -C "$repo" apply --check --whitespace=error "$patch_path"
  printf 'Patch validation passed: %s\n' "$patch_path"
  printf 'Repository unchanged. Apply explicitly with:\n'
  printf 'git -C %q apply %q\n' "$repo" "$patch_path"
fi
