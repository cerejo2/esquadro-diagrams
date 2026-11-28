// Cabeçalho com acentos: ç ã õ é
typedef struct medida {
  int valor;
  const char *nome; /* "pressão" */
} Medida;

int medida_valor(const Medida *m);
