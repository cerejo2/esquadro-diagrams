package workshop;

import java.util.ArrayList;
import java.util.List;

public class Workshop {
    private Bay[] bays;
    private List<RepairOrder> orders;

    public Workshop(int size) {
        bays = new Bay[size];
        for (int i = 0; i < size; i++) {
            bays[i] = new Bay(i + 1);
        }
        orders = new ArrayList<>();
    }

    public boolean checkIn(Car car) {
        for (Bay b : bays) {
            if (b.available()) {
                car.bay = b;
                b.occupant = car;
                orders.add(new RepairOrder(car));
                return true;
            }
        }
        return false;
    }

    public void checkOut(Car car) {
        if (car.bay != null) {
            car.bay.clear();
            car.leave();
        }
    }

    public int openOrders() {
        int n = 0;
        for (RepairOrder o : orders) {
            if (o.getStatus() != Status.DONE) n++;
        }
        return n;
    }
}
