-- A to-do list app, written for Esquadro's fixtures (SQLite 3).
PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS "lista" (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cor     TEXT DEFAULT '#888888'
);

CREATE TABLE IF NOT EXISTS tarefa (
  id        INTEGER PRIMARY KEY,
  lista_id  INTEGER NOT NULL,
  texto     TEXT NOT NULL,
  feita     INTEGER NOT NULL DEFAULT 0 CHECK (feita IN (0, 1)),
  prazo     TEXT,  -- ISO 8601 date
  notas,           -- SQLite allows a column without a type
  CONSTRAINT agrupa FOREIGN KEY (lista_id) REFERENCES "lista" (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tarefa_lista ON tarefa (lista_id, feita);

INSERT INTO lista (titulo) VALUES ('Casa'), ('Trabalho');
INSERT INTO tarefa (lista_id, texto, prazo) VALUES (1, 'Regar as plantas', '2026-12-01');

COMMIT;
