-- Gravado com BOM e fins de linha CRLF.
CREATE TABLE Armazém (
  Código INT PRIMARY KEY,
  Localização NVARCHAR(80) NOT NULL
)
GO
CREATE TABLE Prateleira (
  Número INT PRIMARY KEY,
  Armazém INT NOT NULL CONSTRAINT Guarda REFERENCES Armazém (Código),
  Descrição NVARCHAR(200) -- ção, ã, é, ü
)
GO
