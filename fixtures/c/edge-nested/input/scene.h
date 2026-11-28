typedef struct point { int x, y; } Point;

typedef struct sprite {
  struct frame { int width; int height; } frame;
  struct { int r, g, b; } tint;
  union { int id; const char *label; };
  Point origin;
} Sprite;
