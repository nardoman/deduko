#!/bin/sh
# Deduko KPM launch hook (run by `kpm launch deduko`, e.g. from the scriptlet).
#
# 1. Copies the app to the Mesquite apps folder.
# 2. Adds the extra case packs: first the ones shipped by KPM pack packages
#    (<packages>/<pkg>/deduko-pack/<packId>/), then the USB folder
#    (/mnt/us/deduko/packs/<packId>/). Duplicate pack ids are ignored by the app.
# 3. Writes generated/index.js, the list of language and pack files to load.
# 4. Registers the app in appreg.db and starts it through lipc.
#
# Overrides for testing: DEDUKO_TARGET, DEDUKO_USB_PACKS, DEDUKO_KPM_PACKAGES,
# DEDUKO_NO_LAUNCH=1 (stop after step 3).

APP_ID="com.nardoman.deduko"
DB="/var/local/appreg.db"

PKG_DIR=$(cd "$(dirname "$0")" && pwd)
TARGET="${DEDUKO_TARGET:-/var/local/mesquite/deduko}"
USB="${DEDUKO_USB_PACKS:-/mnt/us/deduko/packs}"
KPMP="${DEDUKO_KPM_PACKAGES:-/mnt/us/kmc/kpm/packages}"

if [ ! -f "$PKG_DIR/app/index.html" ]; then
    echo "Deduko: app not found in $PKG_DIR/app"
    exit 1
fi
case "$TARGET" in
    ""|"/") echo "Deduko: refusing target '$TARGET'"; exit 1 ;;
esac

# Directory names: letters, digits, _ and - only.
valid_name() {
    case "$1" in
        ""|*[!A-Za-z0-9_-]*) return 1 ;;
    esac
    return 0
}

# File names: letters, digits, ., _ and - only.
valid_file() {
    case "$1" in
        ""|*[!A-Za-z0-9._-]*) return 1 ;;
    esac
    return 0
}

# add_pack <source dir> <destination name>: copies the .js files of a pack dir.
add_pack() {
    [ -f "$1/pack.js" ] || return 0
    dst="$TARGET/packs-ext/$2"
    mkdir -p "$dst" || return 0
    for f in "$1"/*.js; do
        [ -f "$f" ] || continue
        n=$(basename "$f")
        valid_file "$n" || continue
        cp "$f" "$dst/$n"
    done
    echo "Deduko: added pack $2"
}

rm -rf "$TARGET"
mkdir -p "$TARGET" || exit 1
cp -r "$PKG_DIR/app/." "$TARGET/" || exit 1
mkdir -p "$TARGET/packs-ext" "$TARGET/generated"

# KPM pack packages
for p in "$KPMP"/*/; do
    [ -d "$p" ] || continue
    pkg=$(basename "$p")
    valid_name "$pkg" || continue
    for d in "$p"deduko-pack/*/; do
        [ -d "$d" ] || continue
        n=$(basename "$d")
        valid_name "$n" || continue
        add_pack "${d%/}" "kpm-$pkg-$n"
    done
done

# USB packs
for d in "$USB"/*/; do
    [ -d "$d" ] || continue
    n=$(basename "$d")
    valid_name "$n" || continue
    add_pack "${d%/}" "usb-$n"
done

# generated/index.js: built-in packs, then KPM packs, then USB packs.
langs=""
for f in "$TARGET"/lang/*.js; do
    [ -f "$f" ] || continue
    n=$(basename "$f")
    valid_file "$n" || continue
    langs="$langs${langs:+, }\"lang/$n\""
done
packs=""
for d in "$TARGET"/packs/*/ "$TARGET"/packs-ext/kpm-*/ "$TARGET"/packs-ext/usb-*/; do
    [ -f "${d}pack.js" ] || continue
    valid_name "$(basename "$d")" || continue
    rel=${d#"$TARGET"/}
    files="\"pack.js\""
    for t in "$d"text.*.js; do
        [ -f "$t" ] || continue
        n=$(basename "$t")
        valid_file "$n" || continue
        files="$files, \"$n\""
    done
    packs="$packs${packs:+, }{\"dir\": \"$rel\", \"files\": [$files]}"
done
printf 'window.DEDUKO_INDEX = {"langs": [%s], "packs": [%s]};\n' "$langs" "$packs" > "$TARGET/generated/index.js" || exit 1
echo "Deduko: index written"

if [ "$DEDUKO_NO_LAUNCH" = "1" ]; then
    exit 0
fi

TARGET_DIR="$TARGET"

#Redeclare To APPREG.DB
sqlite3 "$DB" <<EOF
INSERT OR IGNORE INTO interfaces(interface) VALUES('application');

INSERT OR IGNORE INTO handlerIds(handlerId) VALUES('$APP_ID');

INSERT OR REPLACE INTO properties(handlerId,name,value)
  VALUES('$APP_ID','lipcId','$APP_ID');
INSERT OR REPLACE INTO properties(handlerId,name,value)
  VALUES('$APP_ID','command','/usr/bin/mesquite -l $APP_ID -c file://$TARGET_DIR/');
INSERT OR REPLACE INTO properties(handlerId,name,value)
  VALUES('$APP_ID','supportedOrientation','U');
EOF

echo "Deduko: registered $APP_ID"
sleep 2

#Launch With LIPC
nohup lipc-set-prop com.lab126.appmgrd start app://$APP_ID >/dev/null 2>&1 &
exit 0
