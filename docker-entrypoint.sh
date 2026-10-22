#!/bin/sh
set -e

DATA_DIR="${MONITOR_DATA_DIR:-/app/data}"

mkdir -p "$DATA_DIR"
chown -R monitor:monitor "$DATA_DIR"

exec gosu monitor:monitor "$@"
