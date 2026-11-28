#!/bin/bash
# The library path depends on a variable: guessed from its literal end.
DIR=$(dirname "$0")
source "$DIR/lib/util.sh"
. "${DIR}/lib/absent.sh"
util_hello
