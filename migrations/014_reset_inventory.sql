-- =====================================================
-- MIGRACIÓN: Reset completo de inventario
-- Fecha: 2026-02-04
-- =====================================================

BEGIN;

-- =====================================================
-- 1. AGREGAR NUEVAS COLUMNAS A secondary_skus
-- =====================================================
ALTER TABLE secondary_skus
ADD COLUMN IF NOT EXISTS logistic_type VARCHAR(50) DEFAULT 'cross_docking';

ALTER TABLE secondary_skus
ADD COLUMN IF NOT EXISTS variation_id BIGINT NULL;

-- =====================================================
-- 2. LIMPIAR HISTORIAL Y DATOS RELACIONADOS
-- =====================================================

-- Eliminar auditorías de productos
DELETE FROM product_audits;

-- Eliminar historial de productos
DELETE FROM product_history;

-- Eliminar ventas pendientes
DELETE FROM pending_sales;

-- Eliminar mapeos de productos
DELETE FROM product_mappings;

-- Eliminar SKUs secundarios (vínculos con ML)
DELETE FROM secondary_skus;

-- Eliminar productos
DELETE FROM products;

-- Eliminar categorías
DELETE FROM categories;

-- =====================================================
-- 3. RESETEAR SECUENCIAS (opcional)
-- =====================================================
-- ALTER SEQUENCE products_product_id_seq RESTART WITH 1;
-- ALTER SEQUENCE categories_platform_id_seq RESTART WITH 1;
-- ALTER SEQUENCE secondary_skus_secondary_sku_id_seq RESTART WITH 1;

COMMIT;

-- Verificar
SELECT 'Migración completada' AS status;
SELECT COUNT(*) AS products_count FROM products;
SELECT COUNT(*) AS categories_count FROM categories;
SELECT COUNT(*) AS secondary_skus_count FROM secondary_skus;
