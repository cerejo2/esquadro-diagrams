/* Comments everywhere, /* nested */ as T-SQL and PostgreSQL allow. */
CREATE TABLE artigo ( -- a comment right after the opening parenthesis
  ref /* the key /* nested */ still the comment */ VARCHAR(10) /* , not_a_column INT */ PRIMARY KEY,
  preco DECIMAL( /* precision */ 9, -- scale on the next line
    2) NOT /* still NOT NULL */ NULL,
  -- descricao VARCHAR(100),   (a commented-out column)
  qtd INT DEFAULT 0 -- trailing comment, then the comma on its own line
  ,
  armazem INT # MySQL comment
    REFERENCES armazem /* the PK */ (id)
);

CREATE TABLE armazem (id INT PRIMARY KEY /* -- not a line comment */, cidade VARCHAR(30));
