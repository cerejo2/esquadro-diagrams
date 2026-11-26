public class Livro {
    private final String titulo;
    private Autor autor = new Autor(;

    public Livro(String titulo) {
        this.titulo = titulo;
    }
}
