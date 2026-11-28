-- A small clinic, written for Esquadro's fixtures (PostgreSQL 16).
-- Staff specialise into doctors and nurses; an appointment only exists
-- for a given patient and is numbered within that patient (weak entity).

CREATE SCHEMA IF NOT EXISTS clinica;
SET search_path TO clinica, public;

DROP TABLE IF EXISTS consulta, paciente, enfermeiro, medico, funcionario CASCADE;

CREATE TABLE funcionario (
    id_func      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome         text        NOT NULL,
    nif          char(9)     NOT NULL UNIQUE,
    admitido_em  date        NOT NULL DEFAULT CURRENT_DATE
);

-- Subtypes: the PK is also the FK to funcionario.
CREATE TABLE medico (
    id_func        integer     PRIMARY KEY REFERENCES funcionario (id_func) ON DELETE CASCADE,
    cedula         varchar(12) NOT NULL UNIQUE,
    especialidade  varchar(40) NOT NULL
);

CREATE TABLE enfermeiro (
    id_func  integer      PRIMARY KEY REFERENCES funcionario (id_func) ON DELETE CASCADE,
    turno    varchar(10)  NOT NULL CHECK (turno IN ('manha', 'tarde', 'noite'))
);

CREATE TABLE paciente (
    id_paciente  serial       PRIMARY KEY,
    nome         text         NOT NULL,
    nascimento   date,
    contacto     varchar(20)
);

CREATE TABLE consulta (
    id_paciente    integer      NOT NULL,
    n_consulta     smallint     NOT NULL,
    data_hora      timestamptz  NOT NULL,
    motivo         text,
    id_medico      integer      NOT NULL,
    id_enfermeiro  integer,
    CONSTRAINT consulta_pk PRIMARY KEY (id_paciente, n_consulta),
    CONSTRAINT marca FOREIGN KEY (id_paciente) REFERENCES paciente (id_paciente) ON DELETE CASCADE,
    CONSTRAINT realiza FOREIGN KEY (id_medico) REFERENCES medico (id_func),
    CONSTRAINT assiste FOREIGN KEY (id_enfermeiro) REFERENCES enfermeiro (id_func) ON DELETE SET NULL
);

COMMENT ON TABLE consulta IS 'Weak entity: numbered per patient; the patient''s key is part of the PK.';

CREATE INDEX consulta_medico_idx ON consulta (id_medico, data_hora DESC);

-- Next appointment number for a patient. The body is dollar-quoted and has its own semicolon.
CREATE OR REPLACE FUNCTION proxima_consulta(p integer) RETURNS smallint
LANGUAGE sql STABLE AS $$
    SELECT (COALESCE(MAX(n_consulta), 0) + 1)::smallint FROM consulta WHERE id_paciente = p;
$$;

INSERT INTO paciente (nome, nascimento) VALUES ('Rui Matos', DATE '1990-03-14');
