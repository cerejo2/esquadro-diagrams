package loja;

/** A generic box: its field of type T is not a relation. */
public class Caixa<T extends Produto> {
    private final T conteudo;

    public Caixa(T conteudo) {
        this.conteudo = conteudo;
    }
}
