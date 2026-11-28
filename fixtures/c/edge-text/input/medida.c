// Módulo de medição — comentário em português
#include "medida.h"

static const char *rotulo = "água";

static int dobro_ação(int x) { return x + x; }

int medida_valor(const Medida *m) {
  return dobro_ação(m->valor);
}

int main(void) {
  Medida m = { 1, "olá" };
  (void)rotulo;
  return medida_valor(&m);
}
