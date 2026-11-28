#ifndef STATS_H
#define STATS_H

#include "../common.h"

double stats_mean(const Sample *s);
int stats_max(const Sample *s);
void stats_histogram(const Sample *s, int counts[FACES]);

#endif /* STATS_H */
