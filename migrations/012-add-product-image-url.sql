-- Migration: Add image_url column to products table
-- This allows storing product images from Mercado Libre

ALTER TABLE products
ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) NULL;

-- Add comment for documentation
COMMENT ON COLUMN products.image_url IS 'URL de imagen del producto (desde Mercado Libre u otra fuente)';
