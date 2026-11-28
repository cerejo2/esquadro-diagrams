-- Sorted first: the constraints come before the tables exist.
ALTER TABLE inscricao ADD CONSTRAINT fk_insc_aluno FOREIGN KEY (aluno) REFERENCES aluno (num);
ALTER TABLE inscricao ADD CONSTRAINT fk_insc_cadeira FOREIGN KEY (cadeira) REFERENCES cadeira (codigo);
ALTER TABLE inscricao ADD CONSTRAINT pk_insc PRIMARY KEY (aluno, cadeira);
