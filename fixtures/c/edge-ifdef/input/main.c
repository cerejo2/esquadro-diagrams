#include "sensor.h"

int main(void) {
  Sensor s = { 0, 1 };
  return sensor_read(&s);
}
