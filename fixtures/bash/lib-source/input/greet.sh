#!/usr/bin/env bash
# greet.sh - says hello to every name given on the command line.
# Usage: greet.sh name...

source lib.sh

greet_one() {
    local name
    name=$(trim "$1")
    if [[ -z $name ]]; then
        return 1
    fi
    echo "Hello, $(upper "$name")!"
}

banner "greetings"
for person in "$@"; do
    greet_one "$person" || echo "(skipped an empty name)" >&2
done
