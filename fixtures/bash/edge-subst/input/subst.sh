#!/bin/sh
# Calls inside $( ), backticks and nested substitutions.
now() { date +%F; }
shout() { tr '[:lower:]' '[:upper:]'; }

when=$(now)
old=`now`
echo "today: $(shout "$(now)")"
if [ "$(now)" = "$old" ]; then echo "same day: $when"; fi
