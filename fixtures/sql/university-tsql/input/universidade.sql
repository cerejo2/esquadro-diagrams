/*
  A small university, written for Esquadro's fixtures (T-SQL, SQL Server).
  Students enrol in course units; every unit has a lecturer in charge,
  and lecturers may have a coordinator who is also a lecturer.
*/
IF DB_ID(N'Universidade') IS NULL
    CREATE DATABASE [Universidade];
GO

USE [Universidade];
GO

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

DROP TABLE IF EXISTS [dbo].[INSCRICAO];
DROP TABLE IF EXISTS [dbo].[ALUNO];
DROP TABLE IF EXISTS [dbo].[UC];
DROP TABLE IF EXISTS [dbo].[DOCENTE];
GO

PRINT 'A criar as tabelas...';
GO

-- Lecturers. [coordenador] points back at the same table.
CREATE TABLE [dbo].[DOCENTE] (
    [num_mec]      INT           IDENTITY(1000, 1) NOT NULL,
    [nome]         NVARCHAR(80)  NOT NULL,
    [gabinete]     VARCHAR(10)   NULL,
    [coordenador]  INT           NULL,
    CONSTRAINT [PK_DOCENTE] PRIMARY KEY CLUSTERED ([num_mec]),
    CONSTRAINT [coordena] FOREIGN KEY ([coordenador]) REFERENCES [dbo].[DOCENTE] ([num_mec])
);
GO

CREATE TABLE [dbo].[UC] (
    [codigo]      CHAR(5)        NOT NULL PRIMARY KEY,
    [designacao]  NVARCHAR(120)  NOT NULL,
    [ects]        TINYINT        NOT NULL CONSTRAINT [CK_UC_ects] CHECK ([ects] BETWEEN 1 AND 30),
    [regente]     INT            NOT NULL,
    CONSTRAINT [rege] FOREIGN KEY ([regente]) REFERENCES [dbo].[DOCENTE] ([num_mec]) ON DELETE NO ACTION
);
GO

CREATE TABLE [dbo].[ALUNO] (
    [nmec]       INT            NOT NULL,
    [nome]       NVARCHAR(80)   NOT NULL,
    [email]      VARCHAR(120)   NOT NULL UNIQUE,
    [data_nasc]  DATE           NULL,
    PRIMARY KEY ([nmec])
);
GO

-- Associative table: one row per student and course unit, with the final grade.
CREATE TABLE [dbo].[INSCRICAO] (
    [nmec_aluno]      INT           NOT NULL REFERENCES [dbo].[ALUNO] ([nmec]) ON DELETE CASCADE,
    [codigo_uc]       CHAR(5)       NOT NULL REFERENCES [dbo].[UC] ([codigo]),
    [nota]            DECIMAL(4, 1) NULL CHECK ([nota] >= 0 AND [nota] <= 20),
    [data_inscricao]  DATE          NOT NULL DEFAULT (GETDATE()),
    CONSTRAINT [PK_INSCRICAO] PRIMARY KEY ([nmec_aluno], [codigo_uc])
);
GO

CREATE PROCEDURE [dbo].[media_aluno] @nmec INT
AS
BEGIN
    SELECT AVG([nota]) AS media FROM [dbo].[INSCRICAO] WHERE [nmec_aluno] = @nmec;
END;
GO

INSERT INTO [dbo].[DOCENTE] ([nome], [gabinete], [coordenador]) VALUES (N'Coordenação', '4.2.10', NULL);
INSERT INTO [dbo].[UC] VALUES ('BD101', N'Bases de Dados', 6, 1000);
GO
