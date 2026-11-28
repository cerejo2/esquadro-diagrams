CREATE TABLE sala (
  num INT PRIMARY KEY CHECK ((num > 0) AND (num < (100 * (2 + 3)))),
  lugares INT NOT NULL CHECK (lugares BETWEEN 1 AND 300),
  tipo CHAR(1) CHECK (tipo IN ('A', 'B', ')', '(')),
  CONSTRAINT ck_sala CHECK (((lugares % 2) = 0) OR (tipo = 'A'))
);

CREATE TABLE reserva (
  id INT PRIMARY KEY,
  sala INT NOT NULL,
  inicio TIME, fim TIME,
  CHECK ((fim > inicio) AND (DATEDIFF(MINUTE, inicio, fim) <= (8 * 60))),
  FOREIGN KEY (sala) REFERENCES sala (num)
);
