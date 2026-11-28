#ifndef API_H
#define API_H

typedef struct counter Counter;

Counter *counter_new(int start);
void counter_free(Counter *c);
int counter_next(Counter *c);
int clamp_value(int v, int lo, int hi);

#endif
