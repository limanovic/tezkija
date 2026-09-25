#!/usr/bin/env bash
# Drive the app on an emulator and capture the Play screenshots. Controls are
# located by text via uiautomator, never by hard-coded coordinates.
# Prereqs: app installed and on the home screen, Bosnian UI, notification and
# exact-alarm permissions granted (so no banners), light theme.
set -euo pipefail
cd "$(dirname "$0")/screenshots"
PKG=com.limanovic.tezkija

tap() { # tap the centre of the first element whose text equals $1
  adb shell uiautomator dump /sdcard/u.xml >/dev/null
  local b
  b=$(adb shell cat /sdcard/u.xml | tr '>' '\n' | grep -F "text=\"$1\"" | head -1 \
      | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | grep -o '[0-9]*')
  [ -n "$b" ] || { echo "not found: $1" >&2; exit 1; }
  set -- $b
  adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
  sleep 1.5
}
shot() { adb exec-out screencap -p > "$1"; echo "  $1"; }
back() { adb shell input keyevent KEYCODE_BACK; sleep 1.2; }
home() { adb shell am force-stop $PKG; adb shell am start -n $PKG/.MainActivity >/dev/null; sleep 4; }

home
shot 01-home.png
tap "09:00";                       shot 02-delivery.png; back
tap "Pogledaj sljedeći odlomak";   sleep 1; shot 03-reader.png; back
tap "Nastavi čitanje";             sleep 2; shot 04-list.png; back
tap "⚙"; tap "Tamna"; back
tap "Nastavi čitanje";             sleep 2; shot 05-list-dark.png; back
tap "⚙"; tap "Sistemski"; back
echo ok
