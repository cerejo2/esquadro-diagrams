package loja;

import java.util.*;

/** Nested generics, wildcards and a comment inside a type argument. */
public class Loja {
    private final Map<String, List<Pedido>> porCliente = new HashMap<>();
    private final Map<Cliente, Pedido> ultimo = new HashMap<>();
    private List<? extends Produto> catalogo;
    private List<? super Produto> devolvidos;
    private Set<?> etiquetas;
    private Optional<Cliente> vip = Optional.empty();
    private List</* em promoção */ Produto> promocoes;
    private Produto[][] prateleiras;
    private List<Caixa<Produto>> caixas = new ArrayList<>();

    public void registar(Cliente cliente, Pedido pedido) {
        ultimo.put(cliente, pedido);
    }

    public void setCatalogo(List<? extends Produto> catalogo) {
        this.catalogo = catalogo;
    }

    public void embalar(Produto p) {
        caixas.add(new Caixa<>(p));
    }
}
