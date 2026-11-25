#!/bin/sh
# Name: Deduko - KPM setup
# Author: nardoman
#
# Adds the Deduko KPM repository and installs Deduko from it, without typing
# the long URL in the search bar. Needs Wi-Fi. Everything is shown on screen
# and written to /mnt/us/deduko/kpm-setup.log.
KPM=/var/local/kmc/bin/kpm
URL=https://raw.githubusercontent.com/nardoman/deduko/main/kpm/manifest.json
LOG=/mnt/us/deduko/kpm-setup.log
mkdir -p /mnt/us/deduko
{
    echo "=== Deduko KPM setup $(date) ==="
    echo "user: $(id)"
    echo "--- kpm version"
    "$KPM" version
    echo "--- repositories before"
    "$KPM" -y list-repo
    echo "--- add-repo"
    "$KPM" -y -d add-repo "$URL"
    echo "add-repo exit code: $?"
    echo "--- update"
    "$KPM" -y update
    echo "update exit code: $?"
    echo "--- install deduko"
    "$KPM" -y -d install deduko
    echo "install exit code: $?"
    echo "--- repositories after"
    "$KPM" -y list-repo
    echo "=== done ==="
} 2>&1 | tee "$LOG"
