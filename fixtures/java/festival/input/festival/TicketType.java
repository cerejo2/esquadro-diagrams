package festival;

public enum TicketType {
    DAY,
    WEEKEND,
    VIP;

    public double price() {
        return switch (this) {
            case DAY -> 45;
            case WEEKEND -> 80;
            case VIP -> 150;
        };
    }
}
