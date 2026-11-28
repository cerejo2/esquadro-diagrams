#include <stdio.h>
#include "calc.h"

static int add(int left, int right) { return left + right; }
static int mul(int left, int right) { return left * right; }

static void print_line(const char *line) { puts(line); }

int calculator_apply(Calculator *c, int a, int b) {
  int result = c->combine(a, b);
  c->log("applied");
  c->last = result;
  return result;
}

int run_twice(BinaryOp op, int x) {
  return op(op(x, x), x);
}

int main(void) {
  BinaryOp pick = add;
  Calculator c = { 0 };
  c.combine = mul;
  c.log = print_line;
  pick(1, 2);
  return calculator_apply(&c, 2, 3) + run_twice(add, 1);
}
