package boardgame;

public class Knight extends Piece {
    public Knight(Color color, Position start) {
        super(color, start);
    }

    @Override
    protected boolean canReach(Position target) {
        int dr = Math.abs(getPosition().row() - target.row());
        int dc = Math.abs(getPosition().col() - target.col());
        return dr * dc == 2;
    }
}
