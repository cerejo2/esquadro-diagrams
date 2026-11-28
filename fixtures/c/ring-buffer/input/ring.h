/* A fixed-size circular queue of tagged items, stored by value. */
#ifndef RING_H
#define RING_H

#include <stddef.h>

#define RING_CAPACITY 8

enum ItemKind { ITEM_NUMBER = 1, ITEM_REAL, ITEM_TEXT };

union Payload {
    int number;
    double real;
    char text[8];
};

typedef struct {
    unsigned int id;
    enum ItemKind kind;
    union Payload payload;
} Item;

typedef enum { RING_OK, RING_FULL, RING_EMPTY } RingStatus;

typedef struct {
    Item slots[RING_CAPACITY];
    size_t head;
    size_t count;
} Ring;

void ring_init(Ring *r);
RingStatus ring_push(Ring *r, Item item);
RingStatus ring_pop(Ring *r, Item *out);
size_t ring_count(const Ring *r);
int ring_is_full(const Ring *r);

#endif /* RING_H */
