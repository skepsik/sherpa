#!/usr/bin/env bash
set -euo pipefail

REPO=skepsik/sherpa
PROJECT=6
PROJECT_OWNER=skepsik
TITLE=
BODY_FILE=
COMMENT_ON=
PARENT=
BLOCKED_BY=
BLOCKING=
LABELS=

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t) TITLE=$2; shift 2 ;;
    -F) BODY_FILE=$2; shift 2 ;;
    --comment-on) COMMENT_ON=$2; shift 2 ;;
    --parent) PARENT=$2; shift 2 ;;
    --blocked-by) BLOCKED_BY=$2; shift 2 ;;
    --blocking) BLOCKING=$2; shift 2 ;;
    -l|--label) LABELS=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -n $TITLE && -n $BODY_FILE ]] || {
  echo "Usage: $0 -t TITLE -F body.md [--repo owner/repo] [--parent N] [--comment-on N] [--blocked-by N[,N]] [--blocking N[,N]] [-l label[,label]]" >&2
  exit 1
}

CREATE_ARGS=(issue create --repo "$REPO" -t "$TITLE" -F "$BODY_FILE")
[[ -n $PARENT ]] && CREATE_ARGS+=(--parent "$PARENT")
[[ -n $BLOCKED_BY ]] && CREATE_ARGS+=(--blocked-by "$BLOCKED_BY")
[[ -n $BLOCKING ]] && CREATE_ARGS+=(--blocking "$BLOCKING")
[[ -n $LABELS ]] && CREATE_ARGS+=(-l "$LABELS")

URL=$(gh "${CREATE_ARGS[@]}")
NUM=${URL##*/}
echo "$URL"

if [[ -n $PROJECT && -n $PROJECT_OWNER ]]; then
  if gh project item-add "$PROJECT" --owner "$PROJECT_OWNER" --url "$URL" 2>/dev/null; then
    echo "Added to project $PROJECT" >&2
  else
    echo "Project add skipped (run: gh auth refresh -h github.com -s project,read:project)" >&2
  fi
fi

if [[ -n $COMMENT_ON ]]; then
  printf 'Продолжение в #%s\n' "$NUM" | gh issue comment "$COMMENT_ON" --repo "$REPO" -F -
fi

echo "Issue #$NUM" >&2
