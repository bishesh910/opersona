#!/usr/bin/env bash
#
#   curl -fsSL https://opersona.me/install | bash -s -- --domain persona.example.com
#
# Installs opersona on a fresh Ubuntu/Debian server: Node, Postgres, the app,
# systemd services, and (with --domain) Caddy with automatic TLS.
#
# Piping a script into bash means trusting it. Read it first — that is why this
# file is plain text at a URL and identical to deploy/install.sh in the repo:
#   curl -fsSL https://opersona.me/install | less
#
# It never sends anything anywhere. Every secret it generates stays in .env on
# your machine, and opersona runs on YOUR Claude — there is no account here.
set -euo pipefail

REPO=${OPERSONA_REPO:-https://github.com/bishesh910/opersona.git}
BRANCH=${OPERSONA_BRANCH:-main}
DIR=${OPERSONA_DIR:-$HOME/opersona}
DOMAIN=""
ADMIN_EMAIL=""
ASSUME_YES=0
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:?}"; shift 2 ;;
    --dir) DIR="${2:?}"; shift 2 ;;
    --branch) BRANCH="${2:?}"; shift 2 ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!  %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗  %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY_RUN" = 1 ]; then echo "   (dry-run) $*"; else "$@"; fi; }

# ── preflight ────────────────────────────────────────────────────────────────
[ "$(id -u)" -ne 0 ] || die "Run as a normal user with sudo, not as root — the services run as you."
command -v sudo >/dev/null || die "sudo is required."
. /etc/os-release 2>/dev/null || die "Cannot identify this OS."
case "${ID}${ID_LIKE:-}" in *debian*|ubuntu*) ;; *) die "This installer supports Ubuntu/Debian. For anything else, follow docs/self-hosting.md." ;; esac

cat <<PLAN

opersona installer
  directory   $DIR  (branch $BRANCH)
  database    local postgres, its own role and database
  services    systemd: opersona-web (:3000), opersona-engine (:4000)
  domain      ${DOMAIN:-none — reachable on 127.0.0.1 until you add one}
  secrets     generated here, written to $DIR/.env, never transmitted

PLAN
if [ "$ASSUME_YES" != 1 ] && [ "$DRY_RUN" != 1 ]; then
  [ -t 0 ] || exec < /dev/tty        # piped from curl: talk to the terminal
  read -r -p "Continue? [y/N] " ok; case "$ok" in y|Y) ;; *) exit 1 ;; esac
fi

# ── system packages ──────────────────────────────────────────────────────────
say "system packages"
run sudo apt-get update -qq
run sudo apt-get install -y -qq curl ca-certificates git postgresql openssl >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]; then
  say "Node 22"
  run bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null'
  run sudo apt-get install -y -qq nodejs >/dev/null
fi
command -v pnpm >/dev/null || { say "pnpm"; run sudo corepack enable; run sudo corepack prepare pnpm@9.15.4 --activate; }

# ── database ─────────────────────────────────────────────────────────────────
say "database"
DB_PASS=$(openssl rand -hex 24)
if [ "$DRY_RUN" != 1 ]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL >/dev/null
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='opersona') THEN
    CREATE ROLE opersona LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE opersona PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='opersona'" | grep -q 1 \
    || sudo -u postgres createdb -O opersona opersona
  # Only this role may connect — keeps other apps on the box out of it.
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "REVOKE CONNECT ON DATABASE opersona FROM PUBLIC;" \
    -c "GRANT CONNECT ON DATABASE opersona TO opersona;" >/dev/null
fi

# ── code ─────────────────────────────────────────────────────────────────────
say "code"
if [ -d "$DIR/.git" ]; then run git -C "$DIR" pull --ff-only origin "$BRANCH"
else run git clone -q --branch "$BRANCH" "$REPO" "$DIR"; fi

# ── configuration ────────────────────────────────────────────────────────────
say "configuration"
BASE_URL="http://127.0.0.1:3000"; [ -n "$DOMAIN" ] && BASE_URL="https://$DOMAIN"
if [ -f "$DIR/.env" ]; then
  warn "$DIR/.env already exists — leaving it untouched."
elif [ "$DRY_RUN" != 1 ]; then
  cat > "$DIR/.env" <<ENV
DATABASE_URL=postgres://opersona:${DB_PASS}@localhost:5432/opersona
ENGINE_PORT=4000
ENGINE_DATA_DIR=./data
ENGINE_INTERNAL_TOKEN=$(openssl rand -hex 24)
NEXT_PUBLIC_ENGINE_URL=http://localhost:4000
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_URL=${BASE_URL}
TRUSTED_ORIGINS=${BASE_URL}
SECRETS_KEK=$(openssl rand -base64 32)
ALLOW_SIGNUP=false
REQUIRE_2FA=false
PLATFORM_ADMIN_EMAILS=${ADMIN_EMAIL}
ANTHROPIC_API_KEY=
ENV
  chmod 600 "$DIR/.env"
fi

say "install, migrate, build  (a few minutes)"
run bash -c "cd '$DIR' && pnpm install --frozen-lockfile"
run bash -c "cd '$DIR' && set -a && . ./.env && set +a && pnpm db:migrate"
run bash -c "cd '$DIR' && set -a && . ./.env && set +a && NODE_ENV=production pnpm build"

# ── services ─────────────────────────────────────────────────────────────────
say "services"
NODE_DIR=$(dirname "$(command -v node)")
for svc in engine web; do
  case $svc in
    engine) desc="opersona engine"; wd="$DIR/apps/engine"; start="$NODE_DIR/pnpm -s start"; after="network.target postgresql.service" ;;
    web)    desc="opersona web";    wd="$DIR/apps/web";    start="$NODE_DIR/pnpm -s start"; after="network.target opersona-engine.service" ;;
  esac
  if [ "$DRY_RUN" != 1 ]; then
    sudo tee "/etc/systemd/system/opersona-$svc.service" >/dev/null <<UNIT
[Unit]
Description=$desc
After=$after
[Service]
User=$USER
WorkingDirectory=$wd
EnvironmentFile=$DIR/.env
Environment=NODE_ENV=production PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin HOME=$HOME
ExecStart=$start
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
  fi
done
run sudo systemctl daemon-reload
run sudo systemctl enable --now opersona-engine opersona-web

# ── edge (optional) ──────────────────────────────────────────────────────────
if [ -n "$DOMAIN" ]; then
  say "caddy + TLS for $DOMAIN"
  command -v caddy >/dev/null || run bash -c '
    sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update -qq && sudo apt-get install -y -qq caddy >/dev/null'
  if [ "$DRY_RUN" != 1 ]; then
    sudo mkdir -p /etc/caddy/sites
    grep -q "import sites/\*.caddy" /etc/caddy/Caddyfile 2>/dev/null || echo "import sites/*.caddy" | sudo tee -a /etc/caddy/Caddyfile >/dev/null
    sudo tee /etc/caddy/sites/opersona.caddy >/dev/null <<CADDY
${DOMAIN} {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}
	request_body { max_size 100MB }
	handle /bridge/* { reverse_proxy 127.0.0.1:4000 }
	handle { reverse_proxy 127.0.0.1:3000 { flush_interval -1 } }
	log
}
CADDY
    sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && sudo systemctl reload caddy
  fi
fi

# ── done ─────────────────────────────────────────────────────────────────────
sleep 3
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null || echo 000)
cat <<DONE

✓ opersona is installed. web=$HEALTH  ($DIR)

Next:
  1. Open ${BASE_URL}/sign-up and create the first account.${ADMIN_EMAIL:+ Use $ADMIN_EMAIL — it is already the platform admin.}
  2. Settings → Models → Pair a machine, and run the one command it shows.
     That is what gives your persona a brain: YOUR Claude, on your own plan.
  3. On claude.ai, add ${BASE_URL}/mcp as a custom connector, then say
     "opersona me" in any chat to start the interview.

Config lives in $DIR/.env (0600). Logs: journalctl -u opersona-web -f
Update later: cd $DIR && git pull && pnpm install && pnpm build && sudo systemctl restart opersona-engine opersona-web
DONE
