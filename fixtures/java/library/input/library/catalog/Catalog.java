package library.catalog;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public class Catalog {
    private Map<String, Item> items = new HashMap<>();

    public void add(Item item) {
        items.put(item.getTitle(), item);
    }

    public Optional<Item> find(String title) {
        return Optional.ofNullable(items.get(title));
    }

    public int size() {
        return items.size();
    }
}
