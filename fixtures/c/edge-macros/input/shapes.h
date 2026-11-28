#ifndef SHAPES_H
#define SHAPES_H

#define SQUARE(x) ((x) * (x))
#define TRACE(msg) trace_line(__FILE__, msg)
#define MAX_OF(a, b) ((a) > (b) ? (a) : (b))

void trace_line(const char *file, const char *msg);
int area_of(int side);
int bigger_area(int a, int b);

#endif
