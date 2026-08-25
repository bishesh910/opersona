#!/usr/bin/env bash
# Verifies the sandbox's guarantees on THIS host. Run after setup, or any time.
#   usage: sbx/selftest.sh [data-root]   (default: ./data relative to repo root)
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${1:-$ROOT/apps/engine/data}"
WS="$DATA/sbx-selftest"
mkdir -p "$WS"
run() { OPERSONA_DATA_ROOT="$DATA" "$ROOT/sbx/run.sh" "$WS" 20 "$(printf %s "$1" | base64 -w0)" 2>&1; }
pass=0; fail=0
check() { # name, expectation(ok|blocked), output, blocked_pattern
  local name="$1" want="$2" out="$3" pat="$4"
  if [ "$want" = blocked ]; then
    if printf %s "$out" | grep -qiE "$pat"; then echo "PASS  $name"; pass=$((pass+1)); else echo "FAIL  $name — expected blocked, got: $out"; fail=$((fail+1)); fi
  else
    if printf %s "$out" | grep -qiE "$pat"; then echo "PASS  $name"; pass=$((pass+1)); else echo "FAIL  $name — got: $out"; fail=$((fail+1)); fi
  fi
}
check "python runs"            ok      "$(run 'python3 -c "print(6*7)"')"                                   '^42$'
check "workdir writable"       ok      "$(run 'echo hi > f.txt && cat f.txt')"                              '^hi$'
check "network blocked"        blocked "$(run 'python3 -c "import urllib.request;urllib.request.urlopen(\"http://1.1.1.1\",timeout=3)" 2>&1 | tail -1')" 'unreachable|refused|timed out'
check "/home invisible"        blocked "$(run 'ls /home 2>&1')"                                             'permission denied|cannot|No such'
check "system read-only"       blocked "$(run 'touch /usr/x 2>&1')"                                         'read-only|permission denied'
check "privilege esc dead"     blocked "$(run 'sudo -n true 2>&1')"                                         'no new privileges|not found|a password is required'
rm -rf "$WS"
echo "----"; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
