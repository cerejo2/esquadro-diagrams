package formas;

/** Record with a compact constructor. */
public record Circulo(Ponto centro, double raio) implements Forma {
    public Circulo {
        if (raio <= 0) {
            throw new IllegalArgumentException("raio deve ser positivo");
        }
    }

    public static Circulo unitario() {
        return new Circulo(Ponto.ORIGEM, 1);
    }

    @Override
    public double area() {
        return Math.PI * raio * raio;
    }
}
