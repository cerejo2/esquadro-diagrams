package festival;

public class Concert extends Act {
    private String[] genres;

    public Concert(String name, int minutes, String[] genres) {
        super(name, minutes);
        this.genres = genres;
    }

    @Override
    public String headline() {
        return getName() + " live (" + String.join("/", genres) + ")";
    }
}
