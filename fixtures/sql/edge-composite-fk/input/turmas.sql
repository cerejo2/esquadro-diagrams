-- Composite keys: a parent with a two-column PK and two children that point at it.
CREATE TABLE turma (
  ano INT NOT NULL,
  letra CHAR(1) NOT NULL,
  sala VARCHAR(10),
  CONSTRAINT pk_turma PRIMARY KEY (ano, letra)
);

CREATE TABLE aluno (
  num INT PRIMARY KEY,
  nome VARCHAR(80) NOT NULL,
  turma_ano INT NOT NULL,
  turma_letra CHAR(1) NOT NULL,
  CONSTRAINT pertence FOREIGN KEY (turma_ano, turma_letra) REFERENCES turma (ano, letra)
);

-- A composite FK without a column list points at the PK, in PK order.
CREATE TABLE horario (
  id INT PRIMARY KEY,
  dia SMALLINT NOT NULL,
  t_ano INT,
  t_letra CHAR(1),
  CONSTRAINT marca FOREIGN KEY (t_ano, t_letra) REFERENCES turma
);
