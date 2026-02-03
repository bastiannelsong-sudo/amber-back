-- =====================================================
-- Migration 011: Multi-product mappings
-- Allow one platform SKU to map to multiple products
-- =====================================================

BEGIN;

-- Step 1: Drop existing unique constraint on (platform_id, platform_sku)
-- Find and drop the constraint dynamically
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'product_mappings'::regclass
    AND contype = 'u';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE product_mappings DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Dropped constraint: %', constraint_name;
  END IF;
END $$;

-- Step 2: Add quantity column (default 1 for backward compatibility)
ALTER TABLE product_mappings
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

-- Step 3: Add new unique constraint on (platform_id, platform_sku, product_id)
ALTER TABLE product_mappings
  ADD CONSTRAINT "UQ_product_mappings_platform_sku_product"
  UNIQUE (platform_id, platform_sku, product_id);

COMMIT;

-- Resumen:
--   - Removed UNIQUE(platform_id, platform_sku) → allows multiple products per SKU
--   - Added quantity column (default 1) → backward compatible
--   - Added UNIQUE(platform_id, platform_sku, product_id) → prevents duplicate product in same SKU mapping
