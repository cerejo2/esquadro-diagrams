#!/bin/bash
# Arrays, a long pipeline and process substitution.
list() { ls -1 "$@"; }
keep() { grep -v '^#'; }
tally() { wc -l; }

files=( $(list src) "extra" `tally < /dev/null` )
declare -A seen=( [rm]=1 [ls]=2 )
diff <(list a) <(list b) && tally <<< "${files[*]} ${seen[rm]}"
list src | keep | sort | uniq | keep | tr -d ' ' | tally | head -n 1 >/dev/null
