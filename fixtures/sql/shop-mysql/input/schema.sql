-- A small online shop, written for Esquadro's fixtures (MySQL 8).
-- Foreign keys are added at the end with ALTER TABLE, as dump tools do.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `linha_pedido`, `pedido`, `cartao_pontos`, `produto`, `categoria`, `cliente`;

CREATE TABLE `categoria` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome` VARCHAR(60) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categoria_nome` (`nome`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `produto` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sku` CHAR(12) NOT NULL,
  `nome` VARCHAR(120) NOT NULL,
  `preco` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  `stock` INT NOT NULL DEFAULT 0 COMMENT 'units on hand',
  `categoria_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_produto_sku` (`sku`),
  KEY `idx_produto_categoria` (`categoria_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `cliente` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `nome` VARCHAR(100) NOT NULL,
  `email` VARCHAR(160) NOT NULL UNIQUE,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Loyalty card: at most one per customer (UNIQUE foreign key, so 1:1).
CREATE TABLE `cartao_pontos` (
  `numero` CHAR(10) NOT NULL,
  `pontos` INT NOT NULL DEFAULT 0,
  `cliente_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`numero`),
  UNIQUE (`cliente_id`)
) ENGINE=InnoDB;

-- Guest checkouts have no customer, so cliente_id accepts NULL.
CREATE TABLE `pedido` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` INT UNSIGNED NULL,
  `estado` ENUM('aberto', 'pago', 'enviado', 'cancelado') NOT NULL DEFAULT 'aberto',
  `feito_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `linha_pedido` (
  `pedido_id` INT UNSIGNED NOT NULL,
  `produto_id` INT UNSIGNED NOT NULL,
  `quantidade` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `preco_unitario` DECIMAL(8,2) NOT NULL,
  PRIMARY KEY (`pedido_id`, `produto_id`)
) ENGINE=InnoDB;

ALTER TABLE `produto`
  ADD CONSTRAINT `pertence` FOREIGN KEY (`categoria_id`) REFERENCES `categoria` (`id`);

ALTER TABLE `cartao_pontos`
  ADD CONSTRAINT `tem_cartao` FOREIGN KEY (`cliente_id`) REFERENCES `cliente` (`id`) ON DELETE CASCADE;

ALTER TABLE `pedido`
  ADD CONSTRAINT `faz` FOREIGN KEY (`cliente_id`) REFERENCES `cliente` (`id`) ON DELETE SET NULL;

ALTER TABLE `linha_pedido`
  ADD CONSTRAINT `fk_linha_pedido` FOREIGN KEY (`pedido_id`) REFERENCES `pedido` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_linha_produto` FOREIGN KEY (`produto_id`) REFERENCES `produto` (`id`) ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
