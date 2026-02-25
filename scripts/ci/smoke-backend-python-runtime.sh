#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${1:-}"
if [ -z "$IMAGE_TAG" ]; then
  echo "Usage: $0 <backend-image-tag>" >&2
  exit 1
fi

CONTAINER_NAME="aichat-backend-smoke-$$"
HOST_PORT="18001"
BASE_URL="http://127.0.0.1:${HOST_PORT}"
EXPECTED_PACKAGES=(
  "numpy"
  "sympy"
  "scipy"
  "statsmodels"
  "networkx"
  "scikit-learn"
  "matplotlib"
  "pandas"
  "pulp"
)

cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    echo "[smoke] backend logs (last 200 lines):" >&2
    docker logs --tail 200 "$CONTAINER_NAME" >&2 || true
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[smoke] starting backend container: $IMAGE_TAG"
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${HOST_PORT}:8001" \
  -e DEFAULT_ADMIN_USERNAME=admin \
  -e DEFAULT_ADMIN_PASSWORD=admin123456 \
  -e DB_INIT_ON_START=true \
  "$IMAGE_TAG" >/dev/null

echo "[smoke] waiting for health endpoint..."
for _ in $(seq 1 300); do
  if curl -fsS "${BASE_URL}/api/settings/health" >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl -fsS "${BASE_URL}/api/settings/health" >/dev/null; then
  echo "[smoke] backend health check did not become ready in time" >&2
  exit 1
fi

echo "[smoke] verifying git availability in backend container"
docker exec "$CONTAINER_NAME" git --version >/dev/null

echo "[smoke] logging in with bootstrap admin"
LOGIN_RESPONSE="$(curl -fsS \
  -X POST "${BASE_URL}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123456"}')"

TOKEN="$(printf '%s' "$LOGIN_RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d||'{}');if(!j?.success||!j?.data?.token){process.stderr.write('[smoke] login did not return token\\n');process.exit(2)}process.stdout.write(String(j.data.token))});")"

echo "[smoke] triggering python runtime reconcile API"
curl -fsS \
  -X POST "${BASE_URL}/api/settings/python-runtime/reconcile" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{}' >/dev/null

echo "[smoke] fetching python runtime status"
STATUS_RESPONSE="$(curl -fsS \
  -X GET "${BASE_URL}/api/settings/python-runtime" \
  -H "Authorization: Bearer ${TOKEN}")"

EXPECTED_PACKAGES_CSV="$(IFS=,; echo "${EXPECTED_PACKAGES[*]}")"

EXPECTED_PACKAGES="$EXPECTED_PACKAGES_CSV" node -e '
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const payload = JSON.parse(input || "{}");
  if (!payload?.success || !payload?.data) {
    process.stderr.write("[smoke] runtime status response is invalid\n");
    process.exit(2);
  }

  const status = payload.data;
  const expected = process.env.EXPECTED_PACKAGES.split(",").map((item) => item.trim()).filter(Boolean);
  const dependencies = Array.isArray(status.activeDependencies) ? status.activeDependencies : [];
  const installedPackages = Array.isArray(status.installedPackages) ? status.installedPackages : [];

  const runnerDependencies = dependencies.filter((item) => item?.skillSlug === "python-runner");
  if (runnerDependencies.length === 0) {
    process.stderr.write("[smoke] missing python-runner active dependencies\n");
    process.exit(3);
  }

  const dependencyPackageSet = new Set(
    runnerDependencies.map((item) => String(item?.packageName || "").trim().toLowerCase()).filter(Boolean),
  );
  const missingDeps = expected.filter((name) => !dependencyPackageSet.has(name.toLowerCase()));
  if (missingDeps.length > 0) {
    process.stderr.write(`[smoke] missing declared builtin dependencies: ${missingDeps.join(", ")}\n`);
    process.exit(4);
  }

  const installedSet = new Set(
    installedPackages.map((item) => String(item?.name || "").trim().toLowerCase()).filter(Boolean),
  );
  const missingInstalled = expected.filter((name) => !installedSet.has(name.toLowerCase()));
  if (missingInstalled.length > 0) {
    process.stderr.write(`[smoke] missing installed packages after reconcile: ${missingInstalled.join(", ")}\n`);
    process.exit(5);
  }

  process.stdout.write(`[smoke] runtime status ok: deps=${dependencies.length}, installed=${installedPackages.length}\n`);
});
' <<<"$STATUS_RESPONSE"

echo "[smoke] backend python runtime smoke passed"
