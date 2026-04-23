#!/usr/bin/env bash
# Stop hook: independently check the last commit AND the working tree.
# Warn if either touched supabase/migrations/ or supabase/functions/ without
# touching CLAUDE.md in the same scope. Emits JSON with `systemMessage`.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

check_scope() {
  local scope_name="$1"
  local files="$2"
  local struct md
  struct=$(printf '%s\n' "$files" | grep -E '^supabase/(migrations|functions)/' || true)
  md=$(printf    '%s\n' "$files" | grep -E '^CLAUDE\.md$' || true)
  if [ -n "$struct" ] && [ -z "$md" ]; then
    printf '%s: %s\n' "$scope_name" "$(printf '%s' "$struct" | tr '\n' ' ')"
  fi
}

last_commit=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || true)
working_tree=$(
  {
    git diff --name-only HEAD 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
  } | sort -u
)

warnings=""
w=$(check_scope "last commit"  "$last_commit");  [ -n "$w" ] && warnings+="$w"$'\n'
w=$(check_scope "working tree" "$working_tree"); [ -n "$w" ] && warnings+="$w"$'\n'

if [ -n "$warnings" ]; then
  msg="CLAUDE.md reminder — structural files changed without a CLAUDE.md update in the same scope. If the change added/removed tables, RPC functions, Edge Functions, env vars, or a convention, update CLAUDE.md:
$warnings"
  jq -n --arg m "$msg" '{systemMessage: $m}'
fi
