USE boardgame_db;

-- =========================
-- Boardgames
-- =========================

INSERT INTO boardgames (name, minPlayers, maxPlayers)
VALUES
    ('Rov', 3, 4),
    ('TFT', 2, 10),
    ('Catan', 3, 4);


-- =========================
-- Categories
-- =========================

INSERT INTO categories (name)
VALUES
    ('Strategy'),
    ('Card Game'),
    ('Party Game');


-- =========================
-- Boardgame Categories
-- =========================

INSERT INTO boardgame_categories (boardgame_id, category_id)
VALUES
    (1, 1),
    (1, 2),
    (2, 3),
    (3, 1),
    (3, 3);