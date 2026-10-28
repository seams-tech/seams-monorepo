#!/usr/bin/env bash
set -euo pipefail
umask 077

children=()
configuration_directory=''

cleanup() {
  trap - EXIT INT TERM
  if ((${#children[@]})); then
    local child
    for child in "${children[@]}"; do
      kill -- "-$child" 2>/dev/null || true
    done
    wait "${children[@]}" 2>/dev/null || true
  fi
  if [[ -n "$configuration_directory" ]]; then
    rm -rf -- "$configuration_directory"
  fi
}

start() {
  setsid "$@" &
  children+=("$!")
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

load_configuration() {
  # This is an operator-owned shell environment file, like the VM deployment input.
  set -a
  source "$1"
  set +a
  [[ ${AWS_REGION:-} =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] || fail 'Set AWS_REGION.'
  [[ ${CELLD_BUCKET:-} == s3://* ]] || fail 'Set CELLD_BUCKET to an existing S3 fleet.'
  : "${CELLD_R2_BUCKETS:?Set the existing physical R2 bucket mapping}"

  # A regional path-style endpoint gives every bucket one HTTPS transport route.
  s3_host="s3.${AWS_REGION}.amazonaws.com"
  [[ "$AWS_REGION" != cn-* ]] || s3_host="${s3_host}.cn"
  export S3_ENDPOINT="https://${s3_host}"
  export AWS_ENDPOINT_URL="$S3_ENDPOINT"
  export CELLD_WATCH=/var/lib/celld
  # Enclave-local files disappear on restart. Acknowledged writes need bucket proof.
  export CELLD_DURABILITY=bucket
  unset CELLD_NODE

  read -r -a https_hosts <<< "$s3_host ${NITRO_HTTPS_HOSTS:-}"
  ((${#https_hosts[@]} <= 200)) || fail 'Too many HTTPS destinations.'
  local host
  local -A seen=()
  for host in "${https_hosts[@]}"; do
    [[ "$host" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || fail 'Invalid HTTPS hostname.'
    [[ -z ${seen[$host]:-} ]] || fail 'Duplicate HTTPS hostname.'
    seen[$host]=1
  done
}

run_parent() {
  [[ $# == 2 ]] || fail 'Usage: nitro.sh parent ENV_FILE ENCLAVE_CID'
  local environment_file="$1"
  local enclave_cid="$2"
  [[ "$enclave_cid" =~ ^[1-9][0-9]{0,9}$ ]] && ((enclave_cid >= 4 && enclave_cid < 4294967295)) \
    || fail 'Use an explicit enclave CID from 4 through 4294967294.'

  configuration_directory=$(mktemp -d)
  cp -- "$environment_file" "$configuration_directory/runtime.env"
  chmod 600 "$configuration_directory/runtime.env"
  load_configuration "$configuration_directory/runtime.env"

  # OPEN runs after each accepted connection, so every boot receives the complete file.
  start socat -U VSOCK-LISTEN:9000,reuseaddr,fork \
    "OPEN:$configuration_directory/runtime.env,rdonly"
  # Preserve IMDSv2 requests and the runtime's existing credential refresh behavior.
  start socat VSOCK-LISTEN:9001,reuseaddr,fork TCP4:169.254.169.254:80
  start socat TCP4-LISTEN:8080,bind=127.0.0.1,reuseaddr,fork "VSOCK-CONNECT:$enclave_cid:9002"
  start socat TCP4-LISTEN:8081,bind=127.0.0.1,reuseaddr,fork "VSOCK-CONNECT:$enclave_cid:9003"

  local index
  for index in "${!https_hosts[@]}"; do
    start socat "VSOCK-LISTEN:$((10000 + index)),reuseaddr,fork" "TCP4:${https_hosts[index]}:443"
  done
  printf 'Nitro parent bridges ready for CID %s; TCP listeners use loopback.\n' "$enclave_cid"
}

run_enclave() {
  [[ $# == 0 ]] || fail 'Usage: nitro.sh enclave'
  ip link set lo up
  mkdir -p /run/seams /var/lib/celld
  timeout 30 socat -u VSOCK-CONNECT:3:9000 - > /run/seams/runtime.env
  load_configuration /run/seams/runtime.env
  rm /run/seams/runtime.env

  ip address add 169.254.169.254/32 dev lo
  start socat TCP4-LISTEN:80,bind=169.254.169.254,reuseaddr,fork VSOCK-CONNECT:3:9001

  local index address
  for index in "${!https_hosts[@]}"; do
    address="127.0.0.$((index + 2))"
    printf '%s %s\n' "$address" "${https_hosts[index]}" >> /etc/hosts
    start socat "TCP4-LISTEN:443,bind=$address,reuseaddr,fork" "VSOCK-CONNECT:3:$((10000 + index))"
  done
  start socat VSOCK-LISTEN:9002,reuseaddr,fork TCP4:127.0.0.1:8080
  start socat VSOCK-LISTEN:9003,reuseaddr,fork TCP4:127.0.0.1:8081
  start /opt/seams/celld --no-control-plane --listen 127.0.0.1:8080 \
    --internal-listen 127.0.0.1:8081 --trust-forwarded-headers
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mode=${1:-}
shift || true
case "$mode" in
  parent) run_parent "$@" ;;
  enclave) run_enclave "$@" ;;
  *) fail 'Usage: nitro.sh parent ENV_FILE ENCLAVE_CID | enclave' ;;
esac

# A failed bridge must stop the deployment instead of leaving a partially working node.
status=0
wait -n "${children[@]}" || status=$?
((status != 0)) || status=1
exit "$status"
