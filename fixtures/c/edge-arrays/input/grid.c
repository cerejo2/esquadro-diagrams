#include "grid.h"

int board_sum(const Board *b) {
  int total = 0;
  for (int i = 0; i < b->count; i++) total += b->history[i].value;
  return total;
}
