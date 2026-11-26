package workshop;

public class Bay {
    private int number;
    Car occupant;

    public Bay(int number) {
        this.number = number;
    }

    public int getNumber() {
        return number;
    }

    public boolean available() {
        return occupant == null;
    }

    void clear() {
        occupant = null;
    }
}
