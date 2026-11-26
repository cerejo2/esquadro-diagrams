package formas;

public record Retangulo(Ponto canto, double largura, double altura) implements Forma {
    public Retangulo {
        largura = Math.abs(largura);
        altura = Math.abs(altura);
    }

    @Override
    public double area() {
        return largura * altura;
    }
}
