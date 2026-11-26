package festival;

public abstract class Act implements Schedulable {
    private String name;
    protected int minutes;

    protected Act(String name, int minutes) {
        this.name = name;
        this.minutes = minutes;
    }

    public String getName() {
        return name;
    }

    @Override
    public int duration() {
        return minutes;
    }

    public abstract String headline();
}
