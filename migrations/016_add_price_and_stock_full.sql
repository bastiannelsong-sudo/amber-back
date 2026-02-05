-- Migration 016: Add price column to products
-- Run this to add ML price tracking

-- Add price column (precio de venta en ML)
ALTER TABLE products ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) NULL;

-- Add index for common queries
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
