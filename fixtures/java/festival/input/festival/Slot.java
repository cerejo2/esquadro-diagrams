package festival;

public class Slot<T> {
    private T item;
    private int start;
    private int minutes;

    public Slot(T item, int start, int minutes) {
        this.item = item;
        this.start = start;
        this.minutes = minutes;
    }

    public T getItem() {
        return item;
    }

    public int end() {
        return start + minutes;
    }

    public boolean overlaps(int from, int to) {
        return start < to && from < end();
    }
}
