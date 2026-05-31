#!/bin/bash
# Quick narration tester — generate + play audio from a script, no recording needed.
#
#   ./say.sh "Toh basically chat page repo-first hai."   # inline text
#   ./say.sh -f script.txt                               # from a file
#   pbpaste | ./say.sh                                   # from clipboard (copy script → run)
#
# Optional: LANG=hi ./say.sh ...   (default en — best for Roman Hinglish)
set -e
cd "$(dirname "$0")"

LANGCODE="${LANG_CODE:-en}"
SPEAKER="${SPEAKER:-Ana Florence}"

if [ "$1" = "-f" ] && [ -n "$2" ]; then
  SRC=(--text-file "$2")
elif [ ! -t 0 ]; then          # stdin is piped (e.g. pbpaste | ./say.sh)
  TMP="$(mktemp)"; cat > "$TMP"; SRC=(--text-file "$TMP")
elif [ -n "$1" ]; then
  SRC=(--text "$*")
else
  echo "usage: ./say.sh \"text\"   |   ./say.sh -f script.txt   |   pbpaste | ./say.sh"
  exit 1
fi

OUT="/tmp/gg-narration-$(date +%s).wav"
echo "[say] generating ($LANGCODE, $SPEAKER)…"
COQUI_TOS_AGREED=1 .venv/bin/python narrate.py \
  --engine xtts --lang "$LANGCODE" --speaker "$SPEAKER" "${SRC[@]}" --out "$OUT"
echo "[say] done → $OUT"
open "$OUT"   # macOS plays it
