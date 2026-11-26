package formas;

/** Sealed interface: the permits clause lists subtypes, it is not a relation. */
public sealed interface Forma permits Circulo, Retangulo, Poligono {
    double area();
}
