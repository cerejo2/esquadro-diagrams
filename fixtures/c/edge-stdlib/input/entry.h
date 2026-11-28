#include <stdio.h>
#include <sys/stat.h>
#include <time.h>

typedef struct entry {
  struct stat info;
  struct tm *modified;
  FILE *stream;
  struct entry *next;
} Entry;

void stat_print(struct stat *s);
int tm_year_of(struct tm *t);
int entry_size(Entry *e);
