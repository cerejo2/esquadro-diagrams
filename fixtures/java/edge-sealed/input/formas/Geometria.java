package formas;

public final class Geometria {
    private Geometria() {
    }

    public static String descrever(Forma f) {
        return switch (f) {
            case Circulo c -> "círculo de raio " + c.raio();
            case Retangulo(Ponto canto, double l, double a) -> "retângulo em " + canto;
            case Poligono p -> "polígono";
        };
    }
}
