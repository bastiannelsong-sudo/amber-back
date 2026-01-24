-- Migración: Agregar índices a product_history
-- Fecha: 2025-01-15
-- Descripción: Optimizar queries de historial de productos

-- Índice para buscar historial por producto (query más común)
CREATE INDEX IF NOT EXISTS idx_product_history_product_id
ON product_history(product_id);

-- Índice para filtrar por tipo de cambio
CREATE INDEX IF NOT EXISTS idx_product_history_change_type
ON product_history(change_type);

-- Índice para ordenar por fecha (descendente para mostrar últimos cambios)
CREATE INDEX IF NOT EXISTS idx_product_history_created_at
ON product_history(created_at DESC);

-- Índice compuesto para queries que filtran por producto y ordenan por fecha
CREATE INDEX IF NOT EXISTS idx_product_history_product_date
ON product_history(product_id, created_at DESC);

-- Comentarios en la tabla
COMMENT ON TABLE product_history IS 'Historial completo de cambios realizados en productos';
COMMENT ON COLUMN product_history.history_id IS 'ID único del registro de historial';
COMMENT ON COLUMN product_history.product_id IS 'Referencia al producto modificado';
COMMENT ON COLUMN product_history.field_name IS 'Campo que fue modificado (stock, name, price, etc.)';
COMMENT ON COLUMN product_history.old_value IS 'Valor anterior del campo';
COMMENT ON COLUMN product_history.new_value IS 'Nuevo valor del campo';
COMMENT ON COLUMN product_history.changed_by IS 'Usuario que realizó el cambio';
COMMENT ON COLUMN product_history.change_type IS 'Tipo de cambio: manual, order, adjustment, import';
COMMENT ON COLUMN product_history.change_reason IS 'Razón del cambio (obligatoria para cambios manuales)';
COMMENT ON COLUMN product_history.created_at IS 'Fecha y hora del cambio';

-- Verificar índices creados
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'product_history'
ORDER BY indexname;
