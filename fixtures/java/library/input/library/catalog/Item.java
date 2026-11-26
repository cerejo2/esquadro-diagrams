package library.catalog;

public abstract class Item {
    private String title;
    private int year;

    protected Item(String title, int year) {
        this.title = title;
        this.year = year;
    }

    public String getTitle() {
        return title;
    }

    public int getYear() {
        return year;
    }

    public abstract String describe();
}
