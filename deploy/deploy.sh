#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
SOURCE_DIR="."
DETECT_SUDO=1

print_usage() {
  cat <<EOF
Usage: $0 [--dry-run] [--source DIR] [--no-detect-sudo] [user@host] [/remote/path]

If no target and remote path are provided, the script will use defaults:
  target: root@your.server.example.com
  remote path: /opt/azure-devops-todo

Options:
  --dry-run        Show what rsync would transfer and exit.
  --source DIR     Local source directory to sync (default: current directory).
  --no-detect-sudo Do not try to auto-detect sudo on remote (assume no sudo needed).
EOF
}

# Parse flags
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1; shift;;
    --source)
      SOURCE_DIR="$2"; shift 2;;
    --source=*)
      SOURCE_DIR="${1#--source=}"; shift;;
    --no-detect-sudo)
      DETECT_SUDO=0; shift;;
    -h|--help)
      print_usage; exit 0;;
    --)
      shift; break;;
    -* )
      echo "Unknown option: $1"; print_usage; exit 2;;
    *)
      break;;
  esac
done

# Defaults (used when user runs the script without explicit target/path)
DEFAULT_TARGET="root@158.178.215.93"
DEFAULT_REMOTE_DIR="/opt/azure-devops-todo"

# Resolve target and remote dir in order of precedence:
# 1) positional args
# 2) environment variables DEPLOY_TARGET and DEPLOY_REMOTE
# 3) first non-comment line from deploy/inventory (format: user@host:/remote/path)
# 4) DEFAULT_TARGET / DEFAULT_REMOTE_DIR
if [ $# -ge 2 ]; then
  TARGET="$1"
  REMOTE_DIR="$2"
elif [ $# -eq 1 ]; then
  TARGET="$1"
  REMOTE_DIR="${DEPLOY_REMOTE:-$DEFAULT_REMOTE_DIR}"
else
  # no positional args
  if [ -n "${DEPLOY_TARGET-}" ]; then
    TARGET="$DEPLOY_TARGET"
    REMOTE_DIR="${DEPLOY_REMOTE:-$DEFAULT_REMOTE_DIR}"
  elif [ -f "deploy/inventory" ]; then
    # read first non-empty, non-comment line
  invline=$(awk '{ gsub(/^[ \t]+/, ""); gsub(/[ \t]+$/, ""); if ($0 != "" && $0 !~ /^#/) { print; exit } }' deploy/inventory || true)
    if [ -n "$invline" ]; then
      # expected format: user@host:/remote/path
      TARGET="${invline%%:*}"
      REMOTE_DIR="${invline#*:}"
      if [ "$TARGET" = "$invline" ]; then
        # didn't contain ':' fallback
        TARGET="${invline}"
        REMOTE_DIR="$DEFAULT_REMOTE_DIR"
      fi
    else
      TARGET="$DEFAULT_TARGET"
      REMOTE_DIR="$DEFAULT_REMOTE_DIR"
    fi
  else
    TARGET="$DEFAULT_TARGET"
    REMOTE_DIR="$DEFAULT_REMOTE_DIR"
  fi
fi

echo "Target: ${TARGET}"
echo "Remote dir: ${REMOTE_DIR}"

# Resolve source dir to absolute and verify
if [ -z "$SOURCE_DIR" ]; then SOURCE_DIR="."; fi
if [ ! -d "$SOURCE_DIR" ]; then
  echo "Source directory '$SOURCE_DIR' does not exist."; exit 2
fi
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"

# Ensure .env.production exists and is not empty inside source dir
if [ ! -s "$SOURCE_DIR/.env.production" ]; then
  echo "Error: $SOURCE_DIR/.env.production is missing or empty. Aborting."; exit 3
fi

RSYNC_EXCLUDES=(
  --exclude .git
  --exclude node_modules
  --exclude frontend/node_modules
  --exclude backend/.venv
  --exclude .env.local
  --exclude .env.development
  # Exclude common logs and nohup outputs
  --exclude '*.log'
  --exclude '*nohup*'
  --exclude backend/nohup.out
  --exclude frontend/nohup_frontend.out
  --exclude '*.pyc'
  --exclude __pycache__
)

echo "Preparing to sync '$SOURCE_DIR' -> ${TARGET}:${REMOTE_DIR}"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Running rsync in dry-run mode (showing changes)..."
  rsync -az --delete --dry-run --itemize-changes "${RSYNC_EXCLUDES[@]}" "$SOURCE_DIR"/ "${TARGET}:${REMOTE_DIR}/"
  echo "Dry-run complete. No files were changed. Rerun without --dry-run to perform deploy."
  exit 0
fi

echo "Syncing local files to ${TARGET}:${REMOTE_DIR} ..."
# Try to establish an SSH master connection so password is asked only once.
# ControlPath should be a filesystem path; use a deterministic tmp path per target.
CM_DIR="${HOME}/.ssh/ctrlmasters"
mkdir -p "$CM_DIR"
CM_PATH="$CM_DIR/$(echo "$TARGET" | sed 's/[^a-zA-Z0-9._-]/_/g')"

SSH_COMMON_OPTS="-o ControlPath=$CM_PATH -o ControlMaster=auto -o ControlPersist=600"

echo "Opening SSH master connection to ${TARGET} (you may be prompted for password once)..."
if ssh $SSH_COMMON_OPTS -fN "$TARGET" 2>/dev/null; then
  echo "SSH master started (ControlPath=$CM_PATH)"
  RSYNC_SSH_CMD="ssh $SSH_COMMON_OPTS"
else
  echo "Warning: failed to start SSH master - falling back to per-command auth (you may be prompted multiple times)."
  RSYNC_SSH_CMD="ssh"
fi

rsync -az -e "$RSYNC_SSH_CMD" --delete "${RSYNC_EXCLUDES[@]}" "$SOURCE_DIR"/ "${TARGET}:${REMOTE_DIR}/"

# Detect whether remote needs sudo to run docker/docker compose.
# Use 'docker info' which requires access to the docker socket. Checking
# 'docker compose version' may succeed without socket access and give a
# false negative for permission issues.
REMOTE_DOCKER_CMD="docker compose"
if [ "$DETECT_SUDO" -eq 1 ]; then
  echo "Detecting whether remote requires sudo to access the Docker daemon..."
  # If docker info works without sudo, no need for sudo.
  if ssh $SSH_COMMON_OPTS "$TARGET" "docker info >/dev/null 2>&1"; then
    echo "Remote's Docker daemon is accessible to the user (no sudo required)."
  elif ssh $SSH_COMMON_OPTS "$TARGET" "sudo docker info >/dev/null 2>&1"; then
    echo "Remote requires sudo to access Docker - will prefix remote compose commands with sudo."
    REMOTE_DOCKER_CMD="sudo ${REMOTE_DOCKER_CMD}"
  else
    # Fall back: check if 'docker compose' binary exists at all (best-effort).
    if ssh $SSH_COMMON_OPTS "$TARGET" "command -v docker >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1"; then
      echo "Warning: Docker appears installed but access may be restricted. Will attempt compose; it may fail due to permissions."
    else
      echo "Warning: remote does not seem to have Docker or docker-compose available (even with sudo). Continuing, but compose will likely fail on remote."
    fi
  fi
else
  echo "Skipping remote sudo detection (per --no-detect-sudo). Using 'docker compose' on remote."
fi

echo "Running remote docker compose with .env.production..."
# Print first lines of remote .env.production for confirmation (do not expose secrets elsewhere).
ssh $SSH_COMMON_OPTS "$TARGET" "if [ -f '${REMOTE_DIR}/.env.production' ]; then echo '--- remote .env.production (first 20 lines) ---'; head -n 20 '${REMOTE_DIR}/.env.production'; echo '--- end ---'; else echo 'Remote .env.production not found in ${REMOTE_DIR}'; fi" || true

ssh $SSH_COMMON_OPTS "$TARGET" "mkdir -p ${REMOTE_DIR} && cd ${REMOTE_DIR} && ${REMOTE_DOCKER_CMD} pull || true && ${REMOTE_DOCKER_CMD} --env-file .env.production up -d --build"

# Close the master connection if we started one
if [ -n "$CM_PATH" ]; then
  echo "Closing SSH master connection..."
  ssh -O exit -o ControlPath=$CM_PATH "$TARGET" 2>/dev/null || true
fi

echo "Deployment finished."
