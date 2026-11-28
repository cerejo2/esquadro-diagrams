#include "sensor.h"

static int fast_read(Sensor *s) { return s->channel; }
static int slow_read(Sensor *s) { return s->channel + 1; }

#ifdef FAST_READ
static int read_raw(Sensor *s) { return fast_read(s); }
#else
static int read_raw(Sensor *s) { return slow_read(s); }
#endif

int sensor_read(Sensor *s) {
  return read_raw(s);
}
