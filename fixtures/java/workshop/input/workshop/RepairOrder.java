package workshop;

import java.util.ArrayList;
import java.util.List;

public class RepairOrder {
    private Vehicle vehicle;
    private Status status;
    private List<Task> tasks = new ArrayList<>();

    public RepairOrder(Vehicle vehicle) {
        this.vehicle = vehicle;
        this.status = Status.OPEN;
    }

    public Status getStatus() {
        return status;
    }

    public void addTask(String description, double hours) {
        tasks.add(new Task(description, hours));
    }

    public void advance() {
        status = status.next();
    }

    public double total(double rate) {
        double sum = 0;
        for (Task t : tasks) sum += t.cost(rate);
        return sum;
    }

    static class Task {
        private String description;
        private double hours;

        Task(String description, double hours) {
            this.description = description;
            this.hours = hours;
        }

        public double cost(double rate) {
            return hours * rate;
        }
    }
}
