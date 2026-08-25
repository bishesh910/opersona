#!/usr/bin/env bash
# opersona sandbox runner — executes ONE chat Bash command inside a bubblewrap jail.
#
#   usage: run.sh <workdir> <timeout-seconds> <base64-command>
#
# The engine rewrites every chat Bash tool call to this script (canUseTool), so a
# prompt-injected command can never touch the host. Isolation:
#   - namespaces created as root (sudo bwrap): new mount/pid/net/ipc/uts — NO network
#   - filesystem: /usr,/etc read-only; ONLY the per-conversation workdir is writable
#     (bound at its real path so absolute paths keep working); tmpfs /tmp; no /home,
#     no engine data dir, no ~/.claude, no repo
#   - back to the invoking uid via setpriv with --no-new-privs (sudo/setuid dead inside)
#   - hard timeout + kill
# Requires: bubblewrap, passwordless sudo for the engine user (pilot box: bee).
set -euo pipefail
WS=${1:?workdir}; TMO=${2:?timeout-seconds}; B64=${3:?base64-command}

DATA_ROOT=${OPERSONA_DATA_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data}
WS=$(realpath -e -- "$WS")
case "$WS" in "$DATA_ROOT"/*) ;; *) echo "sbx: workdir outside data root" >&2; exit 1 ;; esac
case "$TMO" in ''|*[!0-9]*) echo "sbx: bad timeout" >&2; exit 1 ;; esac
[ "$TMO" -le 600 ] || TMO=600

CMD=$(printf %s "$B64" | base64 -d) || { echo "sbx: bad command encoding" >&2; exit 1; }
RUID=$(id -u); RGID=$(id -g)

# Optional read-only Node toolchain (fnm install on the pilot box).
NODE_BIND=()
NODE_PATH_EXTRA=""
NODE_DIR=$(ls -d "$HOME"/.local/share/fnm/node-versions/*/installation 2>/dev/null | sort -V | tail -1 || true)
if [ -n "$NODE_DIR" ]; then NODE_BIND=(--perms 0755 --dir /opt --ro-bind "$NODE_DIR" /opt/node); NODE_PATH_EXTRA=":/opt/node/bin"; fi

exec sudo -n /usr/bin/bwrap \
  --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --hostname opersona-sbx \
  --ro-bind /usr /usr \
  --symlink usr/bin /bin --symlink usr/sbin /sbin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --ro-bind /etc /etc \
  --proc /proc --dev /dev \
  --tmpfs /tmp --tmpfs /run --tmpfs /var \
  --bind "$WS" "$WS" --chdir "$WS" \
  "${NODE_BIND[@]}" \
  --clearenv \
  --setenv HOME "$WS" --setenv TMPDIR /tmp --setenv BASH_ENV "" --setenv LANG C.UTF-8 --setenv TERM dumb \
  --setenv PATH "/usr/local/bin:/usr/bin:/bin${NODE_PATH_EXTRA}" \
  /usr/bin/setpriv --reuid "$RUID" --regid "$RGID" --init-groups --no-new-privs \
  /usr/bin/timeout -k 5 "$TMO" /bin/bash --noprofile --norc -c "$CMD"
