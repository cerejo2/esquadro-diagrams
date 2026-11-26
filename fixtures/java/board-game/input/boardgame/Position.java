package boardgame;

public record Position(int row, int col) {
    public Position offset(int dr, int dc) {
        return new Position(row + dr, col + dc);
    }

    public int distance(Position other) {
        return Math.abs(row - other.row) + Math.abs(col - other.col);
    }
}
