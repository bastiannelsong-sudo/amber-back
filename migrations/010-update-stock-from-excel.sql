-- =====================================================
-- Migration 010: Update stock from STOCCK ACTUALIZADO (1).xlsx
-- Only 2 products had stock changes
-- =====================================================

BEGIN;

UPDATE products SET stock = 5 WHERE internal_sku = 'PCR0006';
UPDATE products SET stock = 4 WHERE internal_sku = 'PP02';

COMMIT;

-- Resumen:
--   PCR0006: 6 → 5 (-1)
--   PP02:    5 → 4 (-1)
