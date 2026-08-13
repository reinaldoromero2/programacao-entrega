#!/usr/bin/env bash
# test-check-deploy.sh — Unit tests for check-deploy.sh
#
# Verifies that the smoke test:
#   - Exits 1 when the production server reports the wrong (stale) release
#   - Exits 0 when the production server reports the correct (fresh) release
#
# Runs entirely offline: curl, git, and wc are stubbed with shell wrappers
# that live in a temporary directory prepended to PATH.
#
# Usage: bash scripts/test-check-deploy.sh
#   All tests should pass. Exit code is 0 on success, 1 on any failure.

set -uo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; RESET='\033[0m'
pass() { echo -e "${GREEN}  PASS${RESET} $*"; }
fail() { echo -e "${RED}  FAIL${RESET} $*"; SUITE_FAIL=1; }

SUITE_FAIL=0

# ── Shared test setup ─────────────────────────────────────────────────────────
# Each test creates its own TMPDIR so stubs are isolated.

run_check_deploy() {
  # Args: <expected_release> <curl_response_json>
  # Returns the exit code of check-deploy.sh.
  local expected_release="$1"
  local curl_json="$2"

  local tmpdir
  tmpdir=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '${tmpdir}'" RETURN

  local stub_dir="${tmpdir}/stubs"
  local fake_dist="${tmpdir}/dist"
  mkdir -p "${stub_dir}" "${fake_dist}"

  # ── Stub: dist file (non-empty so check [1/3] passes) ─────────────────────
  local fake_dist_file="${tmpdir}/artifacts/api-server/dist/index.mjs"
  mkdir -p "$(dirname "${fake_dist_file}")"
  echo "// fake bundle" > "${fake_dist_file}"

  # ── Stub: git ─────────────────────────────────────────────────────────────
  # Intercepts:
  #   git rev-parse HEAD             → fixed SHA
  #   git ls-remote <url> <ref>      → same SHA (mirror in sync)
  # All other git sub-commands are forwarded to the real git.
  cat > "${stub_dir}/git" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  rev-parse)
    if [ "${2:-}" = "HEAD" ]; then
      echo "aaabbbcccdddeeefff0000111122223333444455556666"
      exit 0
    fi
    ;;
  ls-remote)
    # Return mirror SHA equal to local HEAD so check [2/3] passes.
    echo "aaabbbcccdddeeefff0000111122223333444455556666	refs/heads/main"
    exit 0
    ;;
esac
# Fallback to real git for anything else (e.g. git config inside deploy.sh)
exec "$(command -v git)" "$@"
STUB
  chmod +x "${stub_dir}/git"

  # ── Stub: curl ────────────────────────────────────────────────────────────
  # Always returns the JSON passed as curl_json, ignoring the actual URL.
  cat > "${stub_dir}/curl" <<STUB
#!/usr/bin/env bash
printf '%s' '${curl_json}'
exit 0
STUB
  chmod +x "${stub_dir}/curl"

  # ── Run check-deploy.sh with stubs in front of PATH ───────────────────────
  GITHUB_PERSONAL_ACCESS_TOKEN="fake-token-for-testing" \
  POLL_ATTEMPTS=1 \
  POLL_INTERVAL=0 \
  PATH="${stub_dir}:${PATH}" \
    bash "$(dirname "$0")/check-deploy.sh" \
      --dist-override "${fake_dist_file}" \
      "${expected_release}" \
    2>&1
}

# check-deploy.sh does not accept --dist-override; we patch DIST_FILE via an
# env-var override instead.  Re-source the check: the script uses $DIST_FILE
# which we can set externally because bash doesn't export local vars by default
# unless we export them.  Easiest approach: wrap the invocation so we rewrite
# DIST_FILE via the env.
run_smoke() {
  local expected_release="$1"
  local curl_json="$2"

  local tmpdir
  tmpdir=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '${tmpdir}'" RETURN

  local stub_dir="${tmpdir}/stubs"
  mkdir -p "${stub_dir}"

  # ── Stub: dist file ───────────────────────────────────────────────────────
  local fake_dist_file="${tmpdir}/index.mjs"
  echo "// fake bundle" > "${fake_dist_file}"

  # ── Stub: git ─────────────────────────────────────────────────────────────
  cat > "${stub_dir}/git" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  rev-parse)
    echo "aaabbbcccdddeeefff0000111122223333444455556666"
    exit 0
    ;;
  ls-remote)
    echo "aaabbbcccdddeeefff0000111122223333444455556666	refs/heads/main"
    exit 0
    ;;
esac
exec "$(command -v git)" "$@"
STUB
  chmod +x "${stub_dir}/git"

  # ── Stub: curl ────────────────────────────────────────────────────────────
  # Escape single-quotes inside the JSON before embedding in heredoc
  local safe_json
  safe_json="${curl_json//\'/\'\\\'\'}"
  cat > "${stub_dir}/curl" <<STUB
#!/usr/bin/env bash
printf '%s' '${safe_json}'
exit 0
STUB
  chmod +x "${stub_dir}/curl"

  # ── Run ───────────────────────────────────────────────────────────────────
  GITHUB_PERSONAL_ACCESS_TOKEN="fake-token-for-testing" \
  POLL_ATTEMPTS=1 \
  POLL_INTERVAL=0 \
  DIST_FILE="${fake_dist_file}" \
  PATH="${stub_dir}:${PATH}" \
    bash "$(dirname "$0")/check-deploy.sh" "${expected_release}" \
    2>&1
  return $?
}

# ── Patch DIST_FILE support into the script if not already present ────────────
# We need check-deploy.sh to honour DIST_FILE env var override for testing.
# Rather than permanently editing the script here, we rely on the already-merged
# env-var support (see the DIST_FILE line added below).  The actual patch lives
# in check-deploy.sh itself (applied separately).

# ── TEST 1: Stale release → exit 1 ───────────────────────────────────────────
echo ""
echo "Test 1: server returns STALE release → script should exit 1"
STALE_JSON='{"status":"ok","release":"20260101000000"}'
EXPECTED_RELEASE="20260813120000"

set +e
OUTPUT=$(run_smoke "${EXPECTED_RELEASE}" "${STALE_JSON}")
EXIT_CODE=$?
set -e

if [ "${EXIT_CODE}" -eq 1 ]; then
  pass "exited with code 1 (stale release detected)"
else
  fail "expected exit 1, got ${EXIT_CODE}"
  echo "--- output ---"
  echo "${OUTPUT}"
  echo "--------------"
fi

# ── TEST 2: Correct release → exit 0 ─────────────────────────────────────────
echo ""
echo "Test 2: server returns CORRECT release → script should exit 0"
FRESH_JSON='{"status":"ok","release":"20260813120000"}'
EXPECTED_RELEASE="20260813120000"

set +e
OUTPUT=$(run_smoke "${EXPECTED_RELEASE}" "${FRESH_JSON}")
EXIT_CODE=$?
set -e

if [ "${EXIT_CODE}" -eq 0 ]; then
  pass "exited with code 0 (correct release confirmed)"
else
  fail "expected exit 0, got ${EXIT_CODE}"
  echo "--- output ---"
  echo "${OUTPUT}"
  echo "--------------"
fi

# ── TEST 3: Empty response (server not yet up) → exit 1 ──────────────────────
echo ""
echo "Test 3: server returns EMPTY body (not yet up) → script should exit 1"
EMPTY_JSON=""
EXPECTED_RELEASE="20260813120000"

set +e
OUTPUT=$(run_smoke "${EXPECTED_RELEASE}" "${EMPTY_JSON}")
EXIT_CODE=$?
set -e

if [ "${EXIT_CODE}" -eq 1 ]; then
  pass "exited with code 1 (no response treated as stale)"
else
  fail "expected exit 1, got ${EXIT_CODE}"
  echo "--- output ---"
  echo "${OUTPUT}"
  echo "--------------"
fi

# ── TEST 4: Response missing 'release' field → exit 1 ────────────────────────
echo ""
echo "Test 4: server response has no 'release' field → script should exit 1"
NOFIELD_JSON='{"status":"ok"}'
EXPECTED_RELEASE="20260813120000"

set +e
OUTPUT=$(run_smoke "${EXPECTED_RELEASE}" "${NOFIELD_JSON}")
EXIT_CODE=$?
set -e

if [ "${EXIT_CODE}" -eq 1 ]; then
  pass "exited with code 1 (missing release field treated as stale)"
else
  fail "expected exit 1, got ${EXIT_CODE}"
  echo "--- output ---"
  echo "${OUTPUT}"
  echo "--------------"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "================================================="
if [ "${SUITE_FAIL}" -eq 0 ]; then
  echo -e "${GREEN} ✅ All tests passed${RESET}"
else
  echo -e "${RED} ❌ One or more tests FAILED${RESET}"
fi
echo "================================================="

exit "${SUITE_FAIL}"
