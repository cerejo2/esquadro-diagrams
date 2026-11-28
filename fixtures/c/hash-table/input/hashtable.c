#include "hashtable.h"

#include <stdlib.h>
#include <string.h>

typedef struct entry {
    char *key;
    int value;
    struct entry *next;
} Entry;

struct hashtable {
    Entry **buckets;
    size_t capacity;
    size_t count;
    unsigned long (*hash)(const char *key);
};

unsigned long hash_djb2(const char *key)
{
    unsigned long h = 5381;
    while (*key)
        h = h * 33 + (unsigned char)*key++;
    return h;
}

static char *copy_key(const char *key)
{
    char *dup = malloc(strlen(key) + 1);
    if (dup != NULL)
        strcpy(dup, key);
    return dup;
}

/* Walks one chain; recursion keeps it short. */
static Entry *entry_find(Entry *e, const char *key)
{
    if (e == NULL || strcmp(e->key, key) == 0)
        return e;
    return entry_find(e->next, key);
}

static size_t hashtable_slot(const HashTable *t, const char *key)
{
    return t->hash(key) % t->capacity;
}

HashTable *hashtable_create(size_t capacity, HashFn hash)
{
    HashTable *t = malloc(sizeof *t);
    if (t == NULL)
        return NULL;
    t->buckets = calloc(capacity, sizeof *t->buckets);
    t->capacity = capacity;
    t->count = 0;
    t->hash = hash;
    return t;
}

void hashtable_destroy(HashTable *t)
{
    for (size_t i = 0; i < t->capacity; i++) {
        Entry *e = t->buckets[i];
        while (e != NULL) {
            Entry *next = e->next;
            free(e->key);
            free(e);
            e = next;
        }
    }
    free(t->buckets);
    free(t);
}

int hashtable_put(HashTable *t, const char *key, int value)
{
    size_t slot = hashtable_slot(t, key);
    Entry *found = entry_find(t->buckets[slot], key);
    if (found != NULL) {
        found->value = value;
        return 0;
    }
    Entry *e = malloc(sizeof *e);
    if (e == NULL)
        return -1;
    e->key = copy_key(key);
    e->value = value;
    e->next = t->buckets[slot];
    t->buckets[slot] = e;
    t->count++;
    return 1;
}

int hashtable_find(const HashTable *t, const char *key, int *out)
{
    Entry *e = entry_find(t->buckets[hashtable_slot(t, key)], key);
    if (e == NULL)
        return 0;
    *out = e->value;
    return 1;
}

size_t hashtable_count(const HashTable *t)
{
    return t->count;
}

void hashtable_foreach(const HashTable *t, Visitor visit, void *ctx)
{
    for (size_t i = 0; i < t->capacity; i++)
        for (Entry *e = t->buckets[i]; e != NULL; e = e->next)
            visit(e->key, e->value, ctx);
}
