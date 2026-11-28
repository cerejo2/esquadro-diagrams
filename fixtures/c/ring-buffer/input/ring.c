#include "ring.h"

/* Position of the slot that is `offset` places after the head. */
static size_t ring_index(const Ring *r, size_t offset)
{
    return (r->head + offset) % RING_CAPACITY;
}

void ring_init(Ring *r)
{
    r->head = 0;
    r->count = 0;
}

RingStatus ring_push(Ring *r, Item item)
{
    if (ring_is_full(r))
        return RING_FULL;
    r->slots[ring_index(r, r->count)] = item;
    r->count++;
    return RING_OK;
}

RingStatus ring_pop(Ring *r, Item *out)
{
    if (r->count == 0)
        return RING_EMPTY;
    *out = r->slots[r->head];
    r->head = ring_index(r, 1);
    r->count--;
    return RING_OK;
}

size_t ring_count(const Ring *r)
{
    return r->count;
}

int ring_is_full(const Ring *r)
{
    return r->count == RING_CAPACITY;
}
