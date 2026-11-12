#!/bin/sh
set -eu
mode=$1
work=$2
installed=$3
version=$4
digest=$5
result=$6
parent_pid=${7:-0}
restart=${8:-no}
payload="$work/payload"
new_app=""
backup=""
swapped=no
closed=no
write_result() {
  # plutil safely encodes arbitrary error strings as JSON.
  /usr/bin/plutil -create xml1 "$result"
  /usr/bin/plutil -insert status -string "$1" "$result"
  /usr/bin/plutil -insert message -string "$2" "$result"
  /usr/bin/plutil -insert version -string "$version" "$result"
  /usr/bin/plutil -convert json "$result"
}
recover() {
  code=$?
  trap - EXIT
  if [ "$code" -ne 0 ]; then
    if [ "$swapped" = yes ] && [ -d "$backup" ]; then
      if [ -d "$installed" ]; then /bin/mv "$installed" "$work/failed-app"; fi
      /bin/mv "$backup" "$installed" || true
    fi
    if [ "$mode" = Install ]; then
      write_result error "Update failed. The previous app was kept; see $work/install.log."
      if [ "$restart" = restart ] && [ "$closed" = yes ]; then /usr/bin/open -n "$installed" || true; fi
    fi
  fi
  exit "$code"
}
trap recover EXIT
if [ "$mode" = Install ]; then exec >>"$work/install.log" 2>&1; fi
case "$mode" in Prepare|Install) ;; *) echo 'Invalid update mode' >&2; exit 1;; esac
case "$installed" in /*.app) ;; *) echo 'Run the installed THK-Chat.app before updating.' >&2; exit 1;; esac
case "$work" in /*) ;; *) exit 1;; esac
[ -f "$installed/Contents/MacOS/chatwork" ]
[ "${#digest}" = 64 ]
case "$digest" in *[!0-9a-fA-F]*) exit 1;; esac
[ "$(/usr/bin/shasum -a 256 "$work/package.download" | /usr/bin/awk '{print $1}')" = "$digest" ] || { echo 'SHA-256 mismatch; update rejected.' >&2; exit 1; }
# Only regular files/directories in the single expected app bundle are accepted.
/usr/bin/tar -tzf "$work/package.download" > "$work/entries.txt"
/usr/bin/awk '
  !/^THK-Chat\.app\// { bad=1 }
  /(^|\/)\.\.?($|\/)/ || /\\/ { bad=1 }
  END { exit bad }
' "$work/entries.txt" || { echo 'Unsafe archive path.' >&2; exit 1; }
/usr/bin/tar -tvzf "$work/package.download" | /usr/bin/awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit bad}' || { echo 'Archive links are not supported.' >&2; exit 1; }
# Each preparation extracts to a new owned directory; no recursive removal is needed.
payload=$(/usr/bin/mktemp -d "$work/payload.XXXXXX")
/usr/bin/tar -xzf "$work/package.download" -C "$payload"
app="$payload/THK-Chat.app"
[ -x "$app/Contents/MacOS/chatwork" ]
[ "$(/usr/bin/plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist")" = com.thk.chat ]
[ "$(/usr/bin/plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")" = "$version" ]
parent_dir=$(/usr/bin/dirname "$installed")
new_app=$(/usr/bin/mktemp -d "$parent_dir/.THK-Chat-update.XXXXXX")
if [ "$mode" = Prepare ]; then /bin/rmdir "$new_app"; printf 'Package verified\n'; exit 0; fi
/usr/bin/ditto "$app" "$new_app/THK-Chat.app"
if [ "$parent_pid" -gt 0 ]; then
  attempts=0
  while /bin/kill -0 "$parent_pid" 2>/dev/null; do
    [ "$attempts" -lt 60 ] || { echo 'The app did not close in time.' >&2; exit 1; }
    /bin/sleep 1
    attempts=$((attempts+1))
  done
fi
closed=yes
backup="$new_app/previous.app"
/bin/mv "$installed" "$backup"
swapped=yes
/bin/mv "$new_app/THK-Chat.app" "$installed"
write_result success 'Update installed.'
if [ "$restart" = restart ]; then /usr/bin/open -n "$installed"; fi
