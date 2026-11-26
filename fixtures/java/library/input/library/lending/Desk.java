package library.lending;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import library.catalog.Catalog;
import library.catalog.Item;

public class Desk {
    private Catalog catalog;
    private List<Loan> loans = new ArrayList<>();

    public Desk(Catalog catalog) {
        this.catalog = catalog;
    }

    public void lend(String title, Member member, LocalDate today) {
        Item item = catalog.find(title).orElseThrow();
        loans.add(new Loan(item, member, today.plusDays(14)));
    }

    public List<Loan> lateLoans(LocalDate today) {
        List<Loan> late = new ArrayList<>();
        for (Loan loan : loans) {
            if (loan.isLate(today)) late.add(loan);
        }
        return late;
    }
}
