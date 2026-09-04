#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SOURCE="$PROJECT_ROOT/bin/codexctl"
TARGET_DIR=${CODEXCTL_BIN_DIR:-"$HOME/.local/bin"}
TARGET="$TARGET_DIR/codexctl"
INITIALIZE=true

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-init) INITIALIZE=false ;;
    *)
      echo "usage: ./scripts/install.sh [--no-init]" >&2
      exit 64
      ;;
  esac
  shift
done

NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
  echo "Node.js 20+ is required" >&2
  exit 1
fi
NODE_MAJOR=$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20+ is required; found $($NODE_BIN --version)" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
if [ -L "$TARGET" ]; then
  CURRENT=$(readlink "$TARGET")
  if [ "$CURRENT" != "$SOURCE" ]; then
    echo "$TARGET already points to $CURRENT; refusing to replace it" >&2
    exit 1
  fi
elif [ -e "$TARGET" ]; then
  echo "$TARGET already exists and is not this project's symlink" >&2
  exit 1
else
  ln -s "$SOURCE" "$TARGET"
fi

if [ "$INITIALIZE" = true ]; then
  "$TARGET" init
fi

echo "installed: $TARGET -> $SOURCE"
