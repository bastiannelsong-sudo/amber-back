-- Rollback Migration: Drop ml_stock_validation_snapshots table
-- Created: 2026-02-05
-- Description: Rollback script to remove stock validation snapshots table

-- Drop indexes first
DROP INDEX IF EXISTS idx_ml_stock_validation_seller_date;
DROP INDEX IF EXISTS idx_ml_stock_validation_seller;

-- Drop the table
DROP TABLE IF EXISTS ml_stock_validation_snapshots;
