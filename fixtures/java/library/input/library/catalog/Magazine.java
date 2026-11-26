package library.catalog;

public class Magazine extends Item {
    private int issue;

    public Magazine(String title, int year, int issue) {
        super(title, year);
        this.issue = issue;
    }

    public int getIssue() {
        return issue;
    }

    public void setIssue(int issue) {
        this.issue = issue;
    }

    @Override
    public String describe() {
        return getTitle() + " #" + issue + " (" + getYear() + ")";
    }
}
