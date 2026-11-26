package workshop;

public enum Status {
    OPEN,
    IN_PROGRESS,
    DONE;

    public Status next() {
        return this == OPEN ? IN_PROGRESS : DONE;
    }
}
