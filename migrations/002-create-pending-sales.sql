-- Migration: Create pending_sales table
-- Description: Tabla para ventas que no pudieron descontar stock automáticamente

-- Crear tipo enum para el estado
CREATE TYPE pending_sale_status AS ENUM ('pending', 'mapped', 'ignored');

CREATE TABLE IF NOT EXISTS pending_sales (
  pending_sale_id SERIAL PRIMARY KEY,
  platform_id INTEGER NOT NULL REFERENCES platforms(platform_id) ON DELETE CASCADE,
  platform_order_id VARCHAR(255) NOT NULL,
  platform_sku VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  sale_date TIMESTAMP NOT NULL,
  raw_data JSONB,
  status pending_sale_status DEFAULT 'pending',
  mapped_to_product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
  resolved_by VARCHAR(255),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Crear índices
CREATE INDEX idx_pending_sales_status ON pending_sales(status);
CREATE INDEX idx_pending_sales_platform ON pending_sales(platform_id);
CREATE INDEX idx_pending_sales_date ON pending_sales(sale_date DESC);
CREATE INDEX idx_pending_sales_order ON pending_sales(platform_order_id);
CREATE INDEX idx_pending_sales_sku ON pending_sales(platform_sku);

-- Agregar comentarios
COMMENT ON TABLE pending_sales IS 'Ventas de plataformas que no pudieron descontar stock automáticamente';
COMMENT ON COLUMN pending_sales.raw_data IS 'Datos completos de la venta en formato JSON';
COMMENT ON COLUMN pending_sales.status IS 'pending: no resuelto, mapped: mapeado a producto, ignored: ignorado por el usuario';
