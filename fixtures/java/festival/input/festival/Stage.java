package festival;

import java.util.ArrayList;
import java.util.List;

public class Stage {
    private String name;
    private List<Slot<Act>> slots = new ArrayList<>();
    private Volunteer[] crew;

    public Stage(String name) {
        this.name = name;
        this.crew = new Volunteer[0];
    }

    public void setCrew(Volunteer[] crew) {
        this.crew = crew;
    }

    public boolean book(Act act, int start) {
        int end = start + act.duration();
        for (Slot<Act> s : slots) {
            if (s.overlaps(start, end)) return false;
        }
        slots.add(new Slot<>(act, start, act.duration()));
        return true;
    }

    public int crewSize() {
        return crew.length;
    }
}
