CREATE SCHEMA vendas;
CREATE SCHEMA rh;

CREATE TABLE vendas.cliente (id INT PRIMARY KEY, nif CHAR(9));
CREATE TABLE rh.cliente (id INT PRIMARY KEY, nome VARCHAR(40), contrato DATE);

-- Unqualified: the referrer's own schema wins.
CREATE TABLE vendas.fatura (id INT PRIMARY KEY, cliente INT NOT NULL REFERENCES cliente (id));
-- Qualified, with brackets.
CREATE TABLE [rh].[ferias] (id INT PRIMARY KEY, cliente INT REFERENCES [rh].[cliente] ([id]));
