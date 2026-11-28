/* A singly linked list of ints. The representation is hidden in list.c. */
#ifndef LIST_H
#define LIST_H

#include <stddef.h>

typedef struct list List;

List *list_create(void);
void list_destroy(List **plist);

void list_push_front(List *l, int value);
void list_push_back(List *l, int value);
int list_pop_front(List *l, int *out);

size_t list_length(const List *l);
long list_sum(const List *l);
void list_reverse(List *l);

#endif /* LIST_H */
