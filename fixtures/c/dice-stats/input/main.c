#include <stdio.h>
#include <stdlib.h>

#include "common.h"
#include "dice/dice.h"
#include "stats/stats.h"
#include "report/report.h"
#include "common.h" /* repeated on purpose: the guard in common.h makes it harmless */

int main(int argc, char *argv[])
{
    unsigned int seed = argc > 1 ? (unsigned int)strtoul(argv[1], NULL, 10) : 42u;
    Sample first;
    Sample second;

    dice_seed(seed);
    dice_fill(&first, 20);
    dice_fill(&second, 40);

    puts("first sample");
    report_print(&first);
    puts("second sample");
    report_print(&second);
    return EXIT_SUCCESS;
}
