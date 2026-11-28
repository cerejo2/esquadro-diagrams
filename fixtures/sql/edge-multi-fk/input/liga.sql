CREATE TABLE equipa (
  id INT PRIMARY KEY,
  nome VARCHAR(40) NOT NULL
);

-- Two FKs to the same table, one inline and one at table level.
CREATE TABLE jogo (
  id INT PRIMARY KEY,
  data DATE NOT NULL,
  visitada INT NOT NULL CONSTRAINT recebe REFERENCES equipa (id),
  visitante INT NOT NULL,
  CONSTRAINT visita FOREIGN KEY (visitante) REFERENCES equipa (id)
);

-- A third one, added later with a column and a constraint in one ADD.
CREATE TABLE arbitro (id INT PRIMARY KEY, nome VARCHAR(40));
ALTER TABLE jogo ADD arbitro_id INT, CONSTRAINT apita FOREIGN KEY (arbitro_id) REFERENCES arbitro;
