#!/bin/bash
# Writes a config file from a template; the heredocs hold code-looking text.
stamp() { date +%s; }
helper() { echo "help"; }

cat <<EOF > out.conf
helper() { rm -rf /; }
built=$(stamp)
EOF

cat <<'RAW'
$(helper)
function bogus { :; }
RAW
