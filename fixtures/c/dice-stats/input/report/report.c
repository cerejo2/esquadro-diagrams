#include <stdio.h>

#include "report.h"
#include "../stats/stats.h"

static void print_bar(int face, int count)
{
    printf("%d | ", face);
    for (int i = 0; i < count; i++)
        putchar('#');
    putchar('\n');
}

void report_print(const Sample *s)
{
    int counts[FACES];
    stats_histogram(s, counts);
    for (int f = 0; f < FACES; f++)
        print_bar(f + 1, counts[f]);
    printf("mean %.2f, max %d\n", stats_mean(s), stats_max(s));
}
