package tarefas;

public class Tarefa {
    private final String titulo;
    private Prioridade prioridade = Prioridade.MEDIA;
    private Estado estado = Estado.ABERTA;

    public Tarefa(String titulo) {
        this.titulo = titulo;
    }

    public void escalar(Prioridade nova) {
        prioridade = nova;
    }

    public void avancar() {
        estado = estado.seguinte();
    }

    enum Estado {
        ABERTA, FECHADA;

        Estado seguinte() {
            return this == ABERTA ? FECHADA : ABERTA;
        }
    }
}
