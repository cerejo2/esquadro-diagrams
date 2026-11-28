#!/bin/bash
# case with several patterns per item, nested loops with break 2 and continue.
show_help() { echo "use: scan FILE..."; }
handle() { printf '%s\n' "$1"; }

for f in "$@"; do
  case $f in
    -h|--help) show_help; exit 0 ;;
    *.txt|*.md) ;;
    *) continue ;;
  esac
  while read -r line; do
    [[ -z $line ]] && continue
    [[ $line == END ]] && break 2
    handle "$line"
  done < "$f"
done
echo "done"
