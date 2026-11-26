package boardgame;

public class Game {
    private Board board;
    private Player[] players;
    private int turn;

    public Game(String[] names, int size) {
        board = new Board(size);
        players = new Player[names.length];
        Color[] colors = Color.values();
        for (int i = 0; i < names.length; i++) {
            Pawn pawn = new Pawn(colors[i % colors.length], new Position(0, i));
            board.place(pawn);
            players[i] = new Player(names[i], pawn);
        }
    }

    public Player next() {
        Player p = players[turn];
        turn = (turn + 1) % players.length;
        return p;
    }

    public int getTurn() {
        return turn;
    }
}
