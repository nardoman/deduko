#!/bin/sh
# Deduko KPM install hook. KPM runs it from the unpacked package folder,
# with "upgrade" as $1 when this install is part of an upgrade.

if [ "$1" = "upgrade" ]; then
    echo "Deduko: upgrading"
fi

# The scriptlet makes Deduko appear in the Kindle library.
cp scriptlet/deduko.sh /mnt/us/documents/deduko.sh || exit 1

# Folder for user case packs (USB storage root, not indexed by the Kindle).
mkdir -p /mnt/us/deduko/packs

echo "Deduko: installed. Open \"Deduko\" from the library to play."
exit 0
