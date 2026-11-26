package festival;

public class Talk extends Act {
    private String speaker;

    public Talk(String name, int minutes, String speaker) {
        super(name, minutes);
        this.speaker = speaker;
    }

    @Override
    public String headline() {
        return speaker + ": " + getName();
    }
}
