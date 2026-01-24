-- Migration: Extend product_history table
-- Description: Agregar campos para trazabilidad multi-plataforma

ALTER TABLE product_history
  ADD COLUMN IF NOT EXISTS platform_id INTEGER REFERENCES platforms(platform_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS platform_order_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS adjustment_amount INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Crear índices para nuevos campos
CREATE INDEX IF NOT EXISTS idx_product_history_platform ON product_history(platform_id);
CREATE INDEX IF NOT EXISTS idx_product_history_order ON product_history(platform_order_id);

-- Agregar comentarios
COMMENT ON COLUMN product_history.platform_id IS 'Plataforma donde ocurrió el cambio (si aplica)';
COMMENT ON COLUMN product_history.platform_order_id IS 'ID de la orden en la plataforma (para ventas automáticas)';
COMMENT ON COLUMN product_history.adjustment_amount IS 'Cantidad del ajuste (+10, -5, etc)';
COMMENT ON COLUMN product_history.metadata IS 'Datos adicionales en formato JSON';
