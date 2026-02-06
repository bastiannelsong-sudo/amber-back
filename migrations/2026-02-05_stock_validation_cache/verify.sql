-- Verification Script: Verify ml_stock_validation_snapshots table
-- Run this after executing the migration to confirm everything is working

-- 1. Check if table exists
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_name = 'ml_stock_validation_snapshots'
    )
    THEN '✅ Table exists'
    ELSE '❌ Table does NOT exist'
  END AS table_check;

-- 2. Check table structure
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'ml_stock_validation_snapshots'
ORDER BY ordinal_position;

-- 3. Check indexes
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'ml_stock_validation_snapshots'
ORDER BY indexname;

-- 4. Check table comments
SELECT
  obj_description('ml_stock_validation_snapshots'::regclass) AS table_comment;

-- 5. Test insert (optional - uncomment to test)
/*
INSERT INTO ml_stock_validation_snapshots (
  seller_id,
  total_items,
  matching_count,
  discrepancy_count,
  error_count,
  results_data,
  execution_time_ms
) VALUES (
  241710025,
  10,
  8,
  2,
  0,
  '{"matching": [], "discrepancies": [], "errors": []}'::jsonb,
  150000
);

-- Verify the insert
SELECT
  snapshot_id,
  seller_id,
  total_items,
  matching_count,
  discrepancy_count,
  error_count,
  created_at,
  execution_time_ms
FROM ml_stock_validation_snapshots
ORDER BY created_at DESC
LIMIT 1;

-- Clean up test data (optional)
DELETE FROM ml_stock_validation_snapshots WHERE snapshot_id = (
  SELECT snapshot_id FROM ml_stock_validation_snapshots ORDER BY created_at DESC LIMIT 1
);
*/

-- 6. Check current record count
SELECT COUNT(*) AS total_snapshots FROM ml_stock_validation_snapshots;

-- 7. Verify JSONB column can store complex data
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'ml_stock_validation_snapshots'
        AND column_name = 'results_data'
        AND data_type = 'jsonb'
    )
    THEN '✅ JSONB column configured correctly'
    ELSE '❌ JSONB column issue'
  END AS jsonb_check;
