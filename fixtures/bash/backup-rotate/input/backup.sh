#!/usr/bin/env bash
# backup.sh - packs folders into dated tarballs and keeps only the newest ones.
# Usage: backup.sh [-d dest] [-k keep] [-v] folder...

DEST="$HOME/backups"
KEEP=5
VERBOSE=0
WORKDIR=""

usage() {
    echo "Usage: $0 [-d dest] [-k keep] [-v] folder..."
    echo "  -d  where the tarballs go (default: ~/backups)"
    echo "  -k  how many tarballs to keep per folder (default: 5)"
    echo "  -v  say what is happening"
}

log() {
    if [[ $VERBOSE -eq 1 ]]; then
        echo "[backup] $*"
    fi
}

die() {
    echo "backup: $1" >&2
    exit 1
}

cleanup() {
    if [[ -n $WORKDIR && -d $WORKDIR ]]; then
        rm -rf "$WORKDIR"
        log "removed $WORKDIR"
    fi
}

on_interrupt() {
    echo >&2
    die "interrupted, nothing was rotated"
}

parse_args() {
    local opt
    while getopts ":d:k:vh" opt; do
        case $opt in
            d) DEST=$OPTARG ;;
            k) KEEP=$OPTARG ;;
            v) VERBOSE=1 ;;
            h)
                usage
                exit 0
                ;;
            :) die "option -$OPTARG needs a value" ;;
            *)
                usage >&2
                exit 2
                ;;
        esac
    done
}

archive_one() {
    local src=$1 name stamp tarball
    name=$(basename "$src")
    stamp=$(date +%Y%m%d-%H%M%S)
    tarball="$WORKDIR/$name-$stamp.tar.gz"
    log "packing $src"
    tar -czf "$tarball" -C "$(dirname "$src")" "$name" || die "tar failed for $src"
    mv "$tarball" "$DEST/"
}

rotate() {
    local name=$1
    ls -1t "$DEST/$name"-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
        log "pruning $old"
        rm -f "$old"
    done
}

main() {
    local dir
    parse_args "$@"
    shift $((OPTIND - 1))
    [[ $# -gt 0 ]] || { usage >&2; exit 2; }

    mkdir -p "$DEST" || die "cannot create $DEST"
    WORKDIR=$(mktemp -d)
    trap cleanup EXIT
    trap on_interrupt INT TERM

    for dir in "$@"; do
        if [[ ! -d $dir ]]; then
            log "skipping $dir (not a folder)"
            continue
        fi
        archive_one "$dir"
        rotate "$(basename "$dir")"
    done
    log "all done"
}

main "$@"
