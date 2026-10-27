CREATE DATABASE IF NOT EXISTS boardgame_db;

USE boardgame_db;

-- =========================
-- Table: boardgames
-- =========================
CREATE TABLE IF NOT EXISTS boardgames (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    minPlayers INT NOT NULL,
    maxPlayers INT NOT NULL,

    CONSTRAINT chk_players
        CHECK (minPlayers >= 1 AND maxPlayers >= minPlayers)
);


-- =========================
-- Table: categories
-- =========================
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);


-- =========================
-- Table: boardgame_categories
-- =========================
CREATE TABLE IF NOT EXISTS boardgame_categories (
    boardgame_id INT NOT NULL,
    category_id INT NOT NULL,

    PRIMARY KEY (boardgame_id, category_id),

    CONSTRAINT fk_boardgame_category_boardgame
        FOREIGN KEY (boardgame_id)
        REFERENCES boardgames(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_boardgame_category_category
        FOREIGN KEY (category_id)
        REFERENCES categories(id)
        ON DELETE CASCADE
);