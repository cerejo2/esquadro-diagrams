INSERT INTO cor VALUES (1, 'azul; e não CREATE TABLE x (y INT)');
INSERT INTO cor (id, nome) VALUES (2, 'verde'), (3, ')');
INSERT INTO peca VALUES (10, 1)
INSERT INTO peca VALUES (11, NULL)
INSERT INTO peca SELECT id + 100, id FROM cor WHERE nome LIKE '%(%';
