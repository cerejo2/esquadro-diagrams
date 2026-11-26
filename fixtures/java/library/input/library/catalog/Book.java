package library.catalog;

import java.util.ArrayList;
import java.util.List;

public class Book extends Item {
    private String isbn;
    private List<Author> authors = new ArrayList<>();

    public Book(String title, int year, String isbn) {
        super(title, year);
        this.isbn = isbn;
    }

    public void addAuthor(Author author) {
        authors.add(author);
    }

    public String getIsbn() {
        return isbn;
    }

    @Override
    public String describe() {
        StringBuilder names = new StringBuilder();
        for (Author a : authors) {
            if (names.length() > 0) names.append(", ");
            names.append(a.name());
        }
        return getTitle() + " by " + names + " (" + getYear() + "), ISBN " + isbn;
    }
}
