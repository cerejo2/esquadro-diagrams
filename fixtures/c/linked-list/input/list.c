#include "list.h"

#include <stdlib.h>

struct node {
    int value;
    struct node *next;
};

struct list {
    struct node *head;
    size_t length;
};

static struct node *node_new(int value, struct node *next)
{
    struct node *n = malloc(sizeof *n);
    if (n == NULL)
        abort();
    n->value = value;
    n->next = next;
    return n;
}

/* Frees the chain from n to the end, back to front. */
static void node_free_all(struct node *n)
{
    if (n == NULL)
        return;
    node_free_all(n->next);
    free(n);
}

static long node_sum(const struct node *n)
{
    return n == NULL ? 0 : n->value + node_sum(n->next);
}

static struct node *list_last(const List *l)
{
    struct node *n = l->head;
    while (n != NULL && n->next != NULL)
        n = n->next;
    return n;
}

List *list_create(void)
{
    List *l = malloc(sizeof *l);
    if (l == NULL)
        abort();
    l->head = NULL;
    l->length = 0;
    return l;
}

void list_destroy(List **plist)
{
    node_free_all((*plist)->head);
    free(*plist);
    *plist = NULL;
}

void list_push_front(List *l, int value)
{
    l->head = node_new(value, l->head);
    l->length++;
}

void list_push_back(List *l, int value)
{
    struct node *last = list_last(l);
    struct node *n = node_new(value, NULL);
    if (last == NULL)
        l->head = n;
    else
        last->next = n;
    l->length++;
}

int list_pop_front(List *l, int *out)
{
    struct node *first = l->head;
    if (first == NULL)
        return 0;
    *out = first->value;
    l->head = first->next;
    free(first);
    l->length--;
    return 1;
}

size_t list_length(const List *l)
{
    return l->length;
}

long list_sum(const List *l)
{
    return node_sum(l->head);
}

void list_reverse(List *l)
{
    struct node *prev = NULL;
    struct node *cur = l->head;
    while (cur != NULL) {
        struct node *next = cur->next;
        cur->next = prev;
        prev = cur;
        cur = next;
    }
    l->head = prev;
}
