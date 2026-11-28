-- Sample rows for schema.sql. Nothing here changes the diagram.
INSERT INTO `categoria` (`nome`) VALUES ('Livros'), ('Jogos de tabuleiro');

INSERT INTO `produto` (`sku`, `nome`, `preco`, `stock`, `categoria_id`) VALUES
  ('LIV-0000001', 'Guia de campo das aves', 18.50, 12, 1),
  ('JOG-0000001', 'Corrida de caracois', 24.90, 3, 2);

INSERT INTO `cliente` (`nome`, `email`) VALUES ('Ana Lopes', 'ana@example.com');

INSERT INTO `pedido` (`cliente_id`, `estado`) VALUES (1, 'pago'), (NULL, 'aberto');

INSERT INTO `linha_pedido` VALUES (1, 1, 2, 18.50), (2, 2, 1, 24.90);

UPDATE `produto` SET `stock` = `stock` - 2 WHERE `id` = 1;
