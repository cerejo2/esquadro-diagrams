-- Only one table has a primary key.
CREATE TABLE sensor (
  serie VARCHAR(20) PRIMARY KEY,
  local VARCHAR(40)
);

CREATE TABLE leitura (
  sensor VARCHAR(20) NOT NULL CONSTRAINT mede REFERENCES sensor,
  instante TIMESTAMP NOT NULL,
  valor REAL
);

CREATE TABLE nota (
  texto TEXT
);
