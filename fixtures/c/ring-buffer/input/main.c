#include <stdio.h>
#include <string.h>

#include "ring.h"

static void describe(const Item *it)
{
    switch (it->kind) {
    case ITEM_NUMBER:
        printf("#%u number %d\n", it->id, it->payload.number);
        break;
    case ITEM_REAL:
        printf("#%u real %.3f\n", it->id, it->payload.real);
        break;
    case ITEM_TEXT:
        printf("#%u text %s\n", it->id, it->payload.text);
        break;
    }
}

int main(void)
{
    Ring r;
    ring_init(&r);

    for (unsigned int i = 0; i < 10; i++) {
        Item it = { .id = i, .kind = ITEM_NUMBER };
        it.payload.number = (int)(i * i);
        if (i % 3 == 1) {
            it.kind = ITEM_REAL;
            it.payload.real = i / 4.0;
        } else if (i % 3 == 2) {
            it.kind = ITEM_TEXT;
            strcpy(it.payload.text, "tick");
        }
        if (ring_push(&r, it) == RING_FULL)
            printf("ring full, item %u dropped\n", i);
    }

    Item out;
    while (ring_pop(&r, &out) == RING_OK)
        describe(&out);
    printf("%zu left\n", ring_count(&r));
    return 0;
}
