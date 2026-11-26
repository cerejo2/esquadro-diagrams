package formas;

public record Ponto(double x, double y) {
    public static final Ponto ORIGEM = new Ponto(0, 0);
}
