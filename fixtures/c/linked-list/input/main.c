#include <stdio.h>

#include "list.h"

/* Pushes n, n-1, ..., 1 to the front, so the list ends up as 1 .. n. */
static void fill(List *l, int n)
{
    if (n == 0)
        return;
    list_push_front(l, n);
    fill(l, n - 1);
}

int main(void)
{
    List *l = list_create();
    fill(l, 5);
    list_push_back(l, 10);
    list_push_back(l, 20);
    list_reverse(l);

    printf("length %zu, sum %ld\n", list_length(l), list_sum(l));

    int v;
    while (list_pop_front(l, &v))
        printf("%d ", v);
    putchar('\n');

    list_destroy(&l);
    return 0;
}
