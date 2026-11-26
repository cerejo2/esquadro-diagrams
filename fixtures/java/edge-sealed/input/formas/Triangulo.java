package formas;

import java.util.List;

public final class Triangulo extends /* três lados */ Poligono {
    public Triangulo(Ponto a, Ponto b, Ponto c) {
        super(List.of(a, b, c));
    }
}
