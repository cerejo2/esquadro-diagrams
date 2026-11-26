package agenda;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Supplier;

/** Lambdas, method references and a local class. */
public class Agenda {
    private final List<Evento> eventos = new ArrayList<>();
    private final Supplier<Lembrete> fabrica = Lembrete::new;
    private final Comparator<Evento> porData = Comparator.comparing(Evento::getData);

    public void importar(List<String> linhas) {
        linhas.forEach(l -> eventos.add(new Evento(l)));
        linhas.stream().map(Conversor::normalizar).forEach(System.out::println);
    }

    public void exportar() {
        class Linha {
            private Formato formato;

            String texto(Evento e) {
                return formato + ":" + e;
            }
        }
        Visitante v = (Etiqueta et) -> System.out.println(et);
        new Linha();
        v.visitar(null);
    }
}
