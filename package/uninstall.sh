#!/bin/sh
# Deduko KPM uninstall hook. KPM runs it from the unpacked package folder,
# with "upgrade" as $1 when the package is being replaced by a newer version.
# It never deletes ./ (KPM does that), never deletes /mnt/us/deduko (user
# case packs) and never writes to the root filesystem.

APP_ID="com.nardoman.deduko"
DB="/var/local/appreg.db"
SCRIPTLET="/mnt/us/documents/deduko.sh"

if [ "$1" = "upgrade" ]; then
    echo "Deduko: upgrade, keeping the scriptlet and the app registration"
    exit 0
fi

# Remove the scriptlet only if it is still the one this package installed.
if [ -f "$SCRIPTLET" ] && [ -f ./scriptlet/deduko.sh ]; then
    if [ "$(md5sum < "$SCRIPTLET")" = "$(md5sum < ./scriptlet/deduko.sh)" ]; then
        rm -f "$SCRIPTLET"
    fi
fi

rm -rf /var/local/mesquite/deduko

if [ -f "$DB" ]; then
    sqlite3 "$DB" "DELETE FROM properties WHERE handlerId='$APP_ID'; DELETE FROM handlerIds WHERE handlerId='$APP_ID';"
fi

echo "Deduko: uninstalled (case packs in /mnt/us/deduko were kept)"
exit 0
