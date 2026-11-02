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
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- เพิ่มใน migration 003

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


-- =========================
-- Table: users (เจ้าของคือ auth-service)
-- password_hash = "scrypt$<salt>$<hash>" ไม่เก็บรหัสผ่านจริง
-- role: สมัครผ่านหน้าเว็บ = member / admin สร้างด้วย npm run create-admin
-- =========================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(30) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('member', 'admin') NOT NULL DEFAULT 'member',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
