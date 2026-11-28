-- A small library, written for Esquadro's fixtures (T-SQL in the old style:
-- no semicolons, statements separated only by new lines and GO).

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'lib')
    EXEC ('CREATE SCHEMA lib')
GO

IF OBJECT_ID('lib.EMPRESTIMO', 'U') IS NULL
BEGIN
    CREATE TABLE lib.EMPRESTIMO (
        id        INT IDENTITY PRIMARY KEY,
        exemplar  INT NOT NULL,
        leitor    INT NOT NULL,
        saida     DATE NOT NULL,
        entrega   DATE NULL
    )
END
GO

CREATE TABLE lib.LIVRO (
    isbn    CHAR(13) NOT NULL CONSTRAINT PK_LIVRO PRIMARY KEY,
    titulo  NVARCHAR(200) NOT NULL,
    ano     SMALLINT NULL
)
CREATE TABLE lib.EXEMPLAR (
    id      INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    isbn    CHAR(13) NOT NULL CONSTRAINT copia_de REFERENCES lib.LIVRO,
    estado  VARCHAR(10) NOT NULL DEFAULT 'bom'
)
CREATE TABLE lib.LEITOR (
    num     INT NOT NULL PRIMARY KEY,
    nome    NVARCHAR(80) NOT NULL
)
GO

ALTER TABLE lib.EMPRESTIMO WITH CHECK ADD
    CONSTRAINT requisita FOREIGN KEY (exemplar) REFERENCES lib.EXEMPLAR (id),
    CONSTRAINT pede FOREIGN KEY (leitor) REFERENCES lib.LEITOR (num)
ALTER TABLE lib.EMPRESTIMO CHECK CONSTRAINT pede
GO

CREATE VIEW lib.EM_ATRASO AS
SELECT e.id, l.nome, x.isbn
FROM lib.EMPRESTIMO AS e
    INNER JOIN lib.LEITOR l ON l.num = e.leitor
    INNER JOIN (lib.EXEMPLAR x INNER JOIN lib.LIVRO v ON v.isbn = x.isbn) ON x.id = e.exemplar
WHERE e.entrega IS NULL AND DATEDIFF(day, e.saida, GETDATE()) > 30
GO

CREATE VIEW lib.LIVROS_POR_ANO (ano, total) AS
SELECT ano, COUNT(*) FROM lib.LIVRO GROUP BY ano
GO

INSERT INTO lib.LIVRO (isbn, titulo, ano) VALUES ('9789720000001', N'Os Maias', 1888)
INSERT INTO lib.LEITOR VALUES (1, N'Inês')
GO
