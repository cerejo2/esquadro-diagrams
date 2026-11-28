/* Shared limits and the Sample type used by every module. */
#ifndef COMMON_H
#define COMMON_H

#define MAX_ROLLS 64
#define FACES 6

typedef struct {
    int values[MAX_ROLLS];
    int n;
} Sample;

#endif /* COMMON_H */
