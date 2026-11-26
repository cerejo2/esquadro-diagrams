// Tiny original samples used by the tree-sitter spike (test and spike page).
import type { Grammar } from '../analyzers/shared/tree-sitter';

export const samples: Record<Grammar, string> = {
  java: `package garden;

import java.util.List;

public class Greenhouse extends Building implements Heated {
    private final List<Plant> plants;

    public Greenhouse(List<Plant> plants) { this.plants = plants; }

    public int count() { return plants.size(); }
}
`,
  c: `#include <stdlib.h>
#include "ring.h"

typedef struct ring {
    int *items;
    int head, size;
} Ring;

Ring *ring_create(int capacity) {
    Ring *r = malloc(sizeof *r);
    r->items = malloc(capacity * sizeof(int));
    return r;
}
`,
  bash: `#!/usr/bin/env bash
backup() {
    local dir="$1"
    if [[ -d "$dir" ]]; then
        tar -czf "$dir.tgz" "$dir"
    else
        echo "missing: $dir" >&2
        return 1
    fi
}

backup "$HOME/notes" || exit 1
`,
};
