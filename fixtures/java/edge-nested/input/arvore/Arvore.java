package arvore;

import java.util.Comparator;
import java.util.Iterator;

/** A static nested class, an inner class and an anonymous class. */
public class Arvore<T> implements Iterable<T> {
    private No<T> raiz;
    private final Comparator<T> ordem;
    private int tamanho;

    public Arvore(Comparator<T> ordem) {
        this.ordem = ordem;
    }

    public void inserir(T valor) {
        raiz = new No<>(valor);
        tamanho++;
    }

    @Override
    public Iterator<T> iterator() {
        return new Percurso();
    }

    public Runnable limpeza() {
        return new Runnable() {
            private No<T> visto;

            @Override
            public void run() {
                raiz = null;
            }
        };
    }

    /** Static nested: does not see the outer instance. */
    public static class No<E> {
        private final E valor;
        private No<E> esquerda;
        private No<E> direita;

        No(E valor) {
            this.valor = valor;
        }
    }

    /** Inner (non-static) class. */
    class Percurso implements Iterator<T> {
        private No<T> atual = raiz;

        @Override
        public boolean hasNext() {
            return atual != null;
        }

        @Override
        public T next() {
            T v = atual.valor;
            atual = atual.direita;
            return v;
        }
    }
}
