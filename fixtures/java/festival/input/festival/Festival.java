package festival;

import java.util.LinkedHashMap;
import java.util.Map;

public class Festival {
    private Map<String, Stage> stages = new LinkedHashMap<>();
    private double revenue;

    public Festival(String... stageNames) {
        for (String n : stageNames) {
            stages.put(n, new Stage(n));
        }
    }

    public Stage stage(String name) {
        return stages.get(name);
    }

    public double sell(TicketType type, int count) {
        double total = type.price() * count;
        revenue += total;
        return total;
    }

    public double getRevenue() {
        return revenue;
    }
}
