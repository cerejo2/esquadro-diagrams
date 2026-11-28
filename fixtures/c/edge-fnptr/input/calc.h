#ifndef CALC_H
#define CALC_H

typedef int (*BinaryOp)(int left, int right);
typedef void Logger(const char *line);

typedef struct calculator {
  BinaryOp combine;
  Logger *log;
  const char *(*describe)(int code);
  int last;
} Calculator;

int calculator_apply(Calculator *c, int a, int b);

#endif
