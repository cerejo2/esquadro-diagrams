#include "dice.h"
#include "../common.h"

/* A small linear congruential generator, so runs are repeatable. */
static unsigned int state = 1u;

void dice_seed(unsigned int seed)
{
    state = seed ? seed : 1u;
}

static unsigned int next_random(void)
{
    state = state * 1103515245u + 12345u;
    return (state / 65536u) % 32768u;
}

int dice_roll(void)
{
    return (int)(next_random() % FACES) + 1;
}

void dice_fill(Sample *s, int n)
{
    s->n = n < MAX_ROLLS ? n : MAX_ROLLS;
    for (int i = 0; i < s->n; i++)
        s->values[i] = dice_roll();
}
