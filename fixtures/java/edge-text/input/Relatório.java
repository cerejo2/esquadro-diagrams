package relatórios;

import java.util.ArrayList;
import java.util.List;

/* class Fantasma { Secção s = new Secção(); } */
// class Outro extends Relatório {}

/** Several top-level types in one file, accents in names, code inside strings and comments. */
public class Relatório {
    private final String título;
    private final List<Secção> secções = new ArrayList<>();
    private final String modelo = "class Falso { Secção s = new Secção(); }";
    private final char aspas = '"';
    private final String bloco = """
        new Fantasma(); // não é código
        class Escondida {}
        """;

    public Relatório(String título) {
        this.título = título;
    }

    public String getTítulo() {
        return título;
    }

    public void acrescentar(String nome) {
        secções.add(new Secção(nome)); // new Fantasma() aqui também não conta
    }

    public int páginas() {
        return Órgão.contar(secções);
    }
}

class Secção {
    private final String nome;

    Secção(String nome) {
        this.nome = nome;
    }
}

final class Órgão {
    private Órgão() {
    }

    static int contar(List<Secção> lista) {
        return lista.size();
    }
}
