package boardgame;

public class Player {
    private String name;
    private Piece piece;
    private int score;

    public Player(String name, Piece piece) {
        this.name = name;
        this.piece = piece;
    }

    public String getName() {
        return name;
    }

    public int getScore() {
        return score;
    }

    public void setScore(int score) {
        this.score = score;
    }

    public boolean play(Board board) {
        Position next = piece.getPosition().offset(board.roll(), 0);
        if (!board.inside(next)) return false;
        return piece.moveTo(next);
    }
}
