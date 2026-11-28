/* A string -> int hash table with separate chaining and a pluggable hash function. */
#ifndef HASHTABLE_H
#define HASHTABLE_H

#include <stddef.h>

typedef unsigned long (*HashFn)(const char *key);
typedef void (*Visitor)(const char *key, int value, void *ctx);

typedef struct hashtable HashTable;

HashTable *hashtable_create(size_t capacity, HashFn hash);
void hashtable_destroy(HashTable *t);

int hashtable_put(HashTable *t, const char *key, int value);
int hashtable_find(const HashTable *t, const char *key, int *out);
size_t hashtable_count(const HashTable *t);
void hashtable_foreach(const HashTable *t, Visitor visit, void *ctx);

unsigned long hash_djb2(const char *key);

#endif /* HASHTABLE_H */
