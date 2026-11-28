#define BOARD_SIZE 16

typedef struct cell { int value; } Cell;

typedef struct board {
  Cell *rows[8];
  Cell **extra;
  Cell slots[BOARD_SIZE];
  Cell *history;
  Cell *focus;
  int count;
} Board;

int board_sum(const Board *b);
