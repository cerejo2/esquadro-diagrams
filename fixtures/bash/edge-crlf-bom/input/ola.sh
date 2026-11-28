#!/bin/bash
# Saudação em português: ação, coração, órfão.
saudação() {
  echo "Olá, $1 — bem-vindo"
}

exige_nome() {
  if [ -z "$1" ]; then
    return 1
  fi
}

exige_nome "$1" || exit 2
saudação "$1"
cat <<EOF
fim
EOF
