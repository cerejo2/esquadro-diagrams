package boardgame;

public abstract class Piece implements Movable {
    private Color color;
    private Position position;

    protected Piece(Color color, Position start) {
        this.color = color;
        this.position = start;
    }

    public Color getColor() {
        return color;
    }

    public Position getPosition() {
        return position;
    }

    @Override
    public boolean moveTo(Position target) {
        if (!canReach(target)) return false;
        position = target;
        return true;
    }

    protected abstract boolean canReach(Position target);
}
