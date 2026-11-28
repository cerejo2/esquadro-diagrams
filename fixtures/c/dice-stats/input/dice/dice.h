#ifndef DICE_H
#define DICE_H

#include "../common.h"

void dice_seed(unsigned int seed);
int dice_roll(void);
void dice_fill(Sample *s, int n);

#endif /* DICE_H */
