#!/usr/bin/env bash
# lib.sh - small text helpers shared by greet.sh and report.sh.
# Load it with "source lib.sh"; running it on its own does nothing.

[[ -n ${LIB_SH_LOADED:-} ]] && return 0
LIB_SH_LOADED=1

trim() {
    local s=$1
    s=${s#"${s%%[![:space:]]*}"}
    s=${s%"${s##*[![:space:]]}"}
    printf '%s' "$s"
}

upper() {
    printf '%s' "${1^^}"
}

repeat_char() {
    local ch=$1 n=$2 out=""
    while ((n > 0)); do
        out+=$ch
        n=$((n - 1))
    done
    printf '%s' "$out"
}

banner() {
    local text
    text=$(upper "$(trim "$1")")
    repeat_char '=' "${#text}"
    echo
    echo "$text"
    repeat_char '=' "${#text}"
    echo
}

is_number() {
    [[ $1 =~ ^[0-9]+$ ]]
}
