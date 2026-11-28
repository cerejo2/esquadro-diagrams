#ifndef SENSOR_H
#define SENSOR_H

typedef struct sensor {
#ifdef WIDE_SAMPLES
  long sample;
#else
  short sample;
#endif
  int channel;
} Sensor;

int sensor_read(Sensor *s);

#endif
