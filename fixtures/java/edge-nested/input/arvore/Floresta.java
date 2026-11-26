package arvore;

import java.util.ArrayList;
import java.util.List;

public class Floresta {
    private final List<Arvore<String>> arvores = new ArrayList<>();
    private Arvore.No<String> destaque;
    private Arvore<String>.Percurso cursor;
}
