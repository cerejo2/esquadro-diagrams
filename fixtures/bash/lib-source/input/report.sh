#!/usr/bin/env bash
# report.sh - prints a stock table from a CSV file with lines "item,quantity".
# Usage: report.sh [file]   (default: items.csv)

. ./lib.sh

print_row() {
    local item qty
    item=$(trim "$1")
    qty=$(trim "$2")
    if is_number "$qty"; then
        printf '%-20s %5d\n' "$item" "$qty"
    else
        printf '%-20s %5s\n' "$item" "?"
    fi
}

main() {
    local file=${1:-items.csv} item qty
    banner "stock report"
    while IFS=, read -r item qty; do
        print_row "$item" "$qty"
    done <"$file"
}

main "$@"
