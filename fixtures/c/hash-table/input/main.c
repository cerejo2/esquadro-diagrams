#include <stdio.h>

#include "hashtable.h"

static void print_entry(const char *key, int value, void *ctx)
{
    int *total = ctx;
    *total += value;
    printf("%s -> %d\n", key, value);
}

static unsigned long hash_length(const char *key)
{
    unsigned long n = 0;
    while (key[n] != '\0')
        n++;
    return n;
}

int main(void)
{
    HashFn pick = hash_length;
    printf("length hash of \"abc\": %lu\n", pick("abc"));

    HashTable *t = hashtable_create(16, hash_djb2);
    hashtable_put(t, "apples", 3);
    hashtable_put(t, "pears", 5);
    hashtable_put(t, "apples", 4);

    int n;
    if (hashtable_find(t, "pears", &n))
        printf("pears: %d\n", n);

    int total = 0;
    hashtable_foreach(t, print_entry, &total);
    printf("%zu keys, total %d\n", hashtable_count(t), total);

    hashtable_destroy(t);
    return 0;
}
