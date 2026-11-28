CREATE TABLE membro (
  id INT PRIMARY KEY,
  nome VARCHAR(50) NOT NULL,
  padrinho INT CONSTRAINT apadrinha REFERENCES membro (id),
  -- The constraint comes before the column it uses.
  CONSTRAINT orienta FOREIGN KEY (orientador) REFERENCES membro,
  orientador INT
);

-- A tree: every folder but the root has a parent folder.
CREATE TABLE pasta (
  id INT PRIMARY KEY,
  mae INT NOT NULL,
  nome VARCHAR(30),
  CONSTRAINT contem FOREIGN KEY (mae) REFERENCES pasta (id)
);
