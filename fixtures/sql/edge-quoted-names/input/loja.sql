CREATE TABLE "Linha de Encomenda" (
  "Num Encomenda" INT NOT NULL,
  [Num Linha] SMALLINT NOT NULL,
  `Preço Unitário` DECIMAL(8, 2),
  "Código ""Artigo""" VARCHAR(12),
  PRIMARY KEY ("Num Encomenda", [Num Linha])
);

CREATE TABLE [Nota de Entrega] (
  [Id] INT PRIMARY KEY,
  [Num Encomenda] INT NOT NULL,
  [Num Linha] SMALLINT NOT NULL,
  CONSTRAINT [entrega linha] FOREIGN KEY ([Num Encomenda], [Num Linha])
    REFERENCES [Linha de Encomenda] ([Num Encomenda], [Num Linha])
);
