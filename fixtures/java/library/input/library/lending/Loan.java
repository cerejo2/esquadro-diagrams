package library.lending;

import java.time.LocalDate;
import library.catalog.Item;

public class Loan {
    private Item item;
    private Member member;
    private LocalDate due;
    private boolean returned;

    public Loan(Item item, Member member, LocalDate due) {
        this.item = item;
        this.member = member;
        this.due = due;
    }

    public boolean isReturned() {
        return returned;
    }

    public void close() {
        returned = true;
    }

    public boolean isLate(LocalDate today) {
        return !returned && today.isAfter(due);
    }
}
