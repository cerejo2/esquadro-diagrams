package tarefas;

/** Enum with a constructor, fields, methods and a constant with its own body. */
public enum Prioridade implements Comparavel<Prioridade> {
    BAIXA(1, "baixa"),
    MEDIA(2, "média"),
    ALTA(3, "alta") {
        @Override
        public boolean urgente() {
            return true;
        }
    };

    private final int peso;
    private final String rotulo;

    Prioridade(int peso, String rotulo) {
        this.peso = peso;
        this.rotulo = rotulo;
    }

    public int getPeso() {
        return peso;
    }

    public boolean urgente() {
        return false;
    }

    public static Prioridade dePeso(int p) {
        for (Prioridade x : values()) {
            if (x.peso == p) {
                return x;
            }
        }
        throw new IllegalArgumentException("peso " + p);
    }

    @Override
    public int comparar(Prioridade outra) {
        return Integer.compare(peso, outra.peso);
    }
}
