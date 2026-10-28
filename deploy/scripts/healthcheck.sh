#!/usr/bin/env sh
set -eu
BASE_URL="${1:?Pass the public HTTPS URL}"
case "$BASE_URL" in https://*) ;; *) echo "HTTPS URL required" >&2; exit 2 ;; esac
curl --fail --silent --show-error --max-time 10 "$BASE_URL/ready" >/dev/null
curl --fail --silent --show-error --max-time 10 "$BASE_URL/" >/dev/null
echo "Web and API readiness checks passed."
