package boardgame;

public class Pawn extends Piece {
    public Pawn(Color color, Position start) {
        super(color, start);
    }

    @Override
    protected boolean canReach(Position target) {
        return getPosition().distance(target) == 1;
    }
}
