package formas;

import java.util.ArrayList;
import java.util.List;

public non-sealed class Poligono implements Forma {
    protected final List<Ponto> vertices = new ArrayList<>();

    public Poligono(List<Ponto> vs) {
        vertices.addAll(vs);
    }

    @Override
    public double area() {
        return 0;
    }
}
