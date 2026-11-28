struct gauge { int level; };

int gauge_level(struct gauge *g) {
  return g->level
}

int broken(int x {
  return x;
}

int gauge_double(struct gauge *g) {
  return gauge_level(g) * 2;
}

int main(void) {
  struct gauge g = { 3 };
  return gauge_double(&g);
}
