-- Migration 017: Add images array column to products
-- Stores all image URLs from MercadoLibre (JSON array)

ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT NULL;
