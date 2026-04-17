#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OCI_DIR="${SCRIPT_DIR}/../oci"

ACTION="${1:-all}"
ENV_FILE="${2:-${OCI_DIR}/oci-free-tier.env}"

run_step() {
  local script_name="$1"
  "${OCI_DIR}/${script_name}" "${ENV_FILE}"
}

case "${ACTION}" in
  preflight)
    run_step "01-preflight.sh"
    ;;
  network)
    run_step "10-network.sh"
    ;;
  launch)
    run_step "20-launch-a1.sh"
    ;;
  bootstrap)
    run_step "30-bootstrap-host.sh"
    ;;
  deploy)
    run_step "40-deploy-app.sh"
    ;;
  verify)
    run_step "50-verify.sh"
    ;;
  all)
    run_step "01-preflight.sh"
    run_step "10-network.sh"
    run_step "20-launch-a1.sh"
    run_step "30-bootstrap-host.sh"
    run_step "40-deploy-app.sh"
    run_step "50-verify.sh"
    ;;
  *)
    echo "Usage: $0 {preflight|network|launch|bootstrap|deploy|verify|all} [env_file]"
    echo "Example: $0 all scripts/deploy/oci/oci-free-tier.env"
    exit 1
    ;;
esac
