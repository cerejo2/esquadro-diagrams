-- A foreign key may point at a UNIQUE column instead of the primary key.
CREATE TABLE socio (
  id INT PRIMARY KEY,
  codigo CHAR(6) NOT NULL UNIQUE,
  nome VARCHAR(60)
);

CREATE TABLE cartao (
  num INT PRIMARY KEY,
  socio_codigo CHAR(6) NOT NULL REFERENCES socio (codigo),
  emitido DATE
);

-- At most one locker per member: a UNIQUE foreign key is a 1:1 link.
CREATE TABLE cacifo (
  num INT PRIMARY KEY,
  socio_id INT UNIQUE,
  CONSTRAINT atribuido FOREIGN KEY (socio_id) REFERENCES socio (id)
);
