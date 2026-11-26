package workshop;

public class Car implements Vehicle {
    private String plate;
    Bay bay;

    public Car(String plate) {
        this.plate = plate;
    }

    @Override
    public String plate() {
        return plate;
    }

    @Override
    public int wheels() {
        return 4;
    }

    void leave() {
        bay = null;
    }
}
