-- Migration: Add stock_bodega column to products table
-- Date: 2026-02-04

ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_bodega INT DEFAULT 0;

-- Update existing rows to have 0 stock_bodega
UPDATE products SET stock_bodega = 0 WHERE stock_bodega IS NULL;
