#include "stats.h"

#include <limits.h>

static long sum_from(const Sample *s, int i)
{
    return i >= s->n ? 0 : s->values[i] + sum_from(s, i + 1);
}

double stats_mean(const Sample *s)
{
    return s->n == 0 ? 0.0 : (double)sum_from(s, 0) / s->n;
}

int stats_max(const Sample *s)
{
    int best = INT_MIN;
    for (int i = 0; i < s->n; i++)
        if (s->values[i] > best)
            best = s->values[i];
    return best;
}

void stats_histogram(const Sample *s, int counts[FACES])
{
    for (int f = 0; f < FACES; f++)
        counts[f] = 0;
    for (int i = 0; i < s->n; i++)
        counts[s->values[i] - 1]++;
}
