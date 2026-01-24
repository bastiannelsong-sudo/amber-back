-- Migration: Create product_mappings table
-- Description: Tabla para mapear SKUs de plataformas con productos internos

CREATE TABLE IF NOT EXISTS product_mappings (
  mapping_id SERIAL PRIMARY KEY,
  platform_id INTEGER NOT NULL REFERENCES platforms(platform_id) ON DELETE CASCADE,
  platform_sku VARCHAR(255) NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_platform_sku UNIQUE(platform_id, platform_sku)
);

-- Crear índices para optimizar búsquedas
CREATE INDEX idx_product_mappings_platform ON product_mappings(platform_id, platform_sku);
CREATE INDEX idx_product_mappings_product ON product_mappings(product_id);
CREATE INDEX idx_product_mappings_active ON product_mappings(is_active);

-- Agregar comentarios para documentación
COMMENT ON TABLE product_mappings IS 'Mapeo entre SKUs de plataformas externas y productos internos';
COMMENT ON COLUMN product_mappings.platform_sku IS 'SKU del producto en la plataforma externa (ML, Falabella, etc)';
COMMENT ON COLUMN product_mappings.is_active IS 'Indica si el mapeo está activo o deshabilitado';
