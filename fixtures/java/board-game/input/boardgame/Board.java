package boardgame;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public class Board {
    private int size;
    private List<Piece> pieces = new ArrayList<>();
    private Dice dice;

    public Board(int size) {
        this.size = size;
        this.dice = new Dice(6);
    }

    public void place(Piece piece) {
        pieces.add(piece);
    }

    public boolean inside(Position p) {
        return p.row() >= 0 && p.col() >= 0 && p.row() < size && p.col() < size;
    }

    public int roll() {
        return dice.roll();
    }

    class Dice {
        private int faces;
        private Random random = new Random();

        Dice(int faces) {
            this.faces = faces;
        }

        public int roll() {
            return 1 + random.nextInt(faces);
        }
    }
}
