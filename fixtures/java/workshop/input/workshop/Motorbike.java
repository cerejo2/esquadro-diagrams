package workshop;

public class Motorbike implements Vehicle {
    private String plate;

    public Motorbike(String plate) {
        this.plate = plate;
    }

    @Override
    public String plate() {
        return plate;
    }

    @Override
    public int wheels() {
        return 2;
    }
}
