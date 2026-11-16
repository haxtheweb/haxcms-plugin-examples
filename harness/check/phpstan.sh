#!/usr/bin/env bash
# Static analysis (PHPStan, level 5) of plugins' PHP code, the same tool and
# level haxcms-php runs on its own backend. hax-plugin-check calls this with
# the plugin folders to analyse; run it by hand the same way:
#
#   bash harness/check/phpstan.sh core-plugins/feeds
#   bash harness/check/phpstan.sh core-plugins contrib-plugins examples
#   bash harness/check/phpstan.sh --generate-baseline harness/check/phpstan-baseline.neon core-plugins contrib-plugins examples
#
# Configuration: harness/check/phpstan.neon. Errors that existed when the
# check was added are in harness/check/phpstan-baseline.neon, so only NEW
# errors fail; the baseline only shrinks.
#
# PHPStan is downloaded as the official phpstan.phar from the release pinned
# below (the same version haxcms-php pins), kept in a cache directory outside
# the repo, and refused unless its SHA-256 matches the pin.
#
# Environment:
#   PHPSTAN_CACHE_DIR  where the phar is kept (default ~/.cache/haxcms-phpstan, shared with haxcms-php)
#   PHPSTAN_PHAR       use an already-downloaded phar (still checksum-verified)
set -euo pipefail

# To upgrade: change both values together (keep them equal to haxcms-php's scripts/phpstan.sh).
PHPSTAN_VERSION="2.3.2"
PHPSTAN_SHA256="0ded687c44b1f9d0346f7f00fa505212b018efe532b2b18e3a72f6e16feb32be"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cache_dir="${PHPSTAN_CACHE_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/haxcms-phpstan}"
phar="${PHPSTAN_PHAR:-${cache_dir}/phpstan-${PHPSTAN_VERSION}.phar}"

sha256_of() {
  php -r 'echo hash_file("sha256", $argv[1]);' "$1"
}

if [ ! -f "${phar}" ]; then
  if [ -n "${PHPSTAN_PHAR:-}" ]; then
    echo "PHPSTAN_PHAR=${PHPSTAN_PHAR} does not exist" >&2
    exit 2
  fi
  mkdir -p "${cache_dir}"
  tmp="$(mktemp "${cache_dir}/phpstan.XXXXXX")"
  trap 'rm -f "${tmp}"' EXIT
  echo "Downloading PHPStan ${PHPSTAN_VERSION}..." >&2
  curl -fsSL --retry 3 -o "${tmp}" \
    "https://github.com/phpstan/phpstan/releases/download/${PHPSTAN_VERSION}/phpstan.phar"
  actual="$(sha256_of "${tmp}")"
  if [ "${actual}" != "${PHPSTAN_SHA256}" ]; then
    echo "phpstan.phar checksum mismatch: expected ${PHPSTAN_SHA256}, got ${actual}" >&2
    exit 2
  fi
  mv "${tmp}" "${phar}"
  trap - EXIT
fi

actual="$(sha256_of "${phar}")"
if [ "${actual}" != "${PHPSTAN_SHA256}" ]; then
  echo "${phar} is not PHPStan ${PHPSTAN_VERSION} (checksum ${actual}); delete it and rerun" >&2
  exit 2
fi

exec php "${phar}" analyse --no-progress --memory-limit=2G -c "${here}/phpstan.neon" "$@"
