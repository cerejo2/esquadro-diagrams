#include <stdio.h>
#include "shapes.h"

void trace_line(const char *file, const char *msg) {
  printf("%s: %s\n", file, msg);
}

int area_of(int side) {
  TRACE("area");
  return SQUARE(side);
}

int bigger_area(int a, int b) {
  return MAX_OF(area_of(a), area_of(b));
}
