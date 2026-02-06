-- Migration: Create ml_stock_validation_snapshots table
-- Created: 2026-02-05
-- Description: Table to cache stock validation results from Mercado Libre

-- Create the table
CREATE TABLE IF NOT EXISTS ml_stock_validation_snapshots (
  snapshot_id SERIAL PRIMARY KEY,
  seller_id BIGINT NOT NULL,
  total_items INTEGER DEFAULT 0,
  matching_count INTEGER DEFAULT 0,
  discrepancy_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  results_data JSONB NOT NULL,
  execution_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ml_stock_validation_seller_date
  ON ml_stock_validation_snapshots(seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ml_stock_validation_seller
  ON ml_stock_validation_snapshots(seller_id);

-- Add comments for documentation
COMMENT ON TABLE ml_stock_validation_snapshots IS 'Stores cached results of stock validation between local inventory and Mercado Libre';
COMMENT ON COLUMN ml_stock_validation_snapshots.snapshot_id IS 'Primary key - auto-incrementing ID';
COMMENT ON COLUMN ml_stock_validation_snapshots.seller_id IS 'Mercado Libre seller ID';
COMMENT ON COLUMN ml_stock_validation_snapshots.total_items IS 'Total number of products validated';
COMMENT ON COLUMN ml_stock_validation_snapshots.matching_count IS 'Number of products with matching stock';
COMMENT ON COLUMN ml_stock_validation_snapshots.discrepancy_count IS 'Number of products with stock discrepancies';
COMMENT ON COLUMN ml_stock_validation_snapshots.error_count IS 'Number of products with validation errors';
COMMENT ON COLUMN ml_stock_validation_snapshots.results_data IS 'Full validation results in JSON format (matching, discrepancies, errors arrays)';
COMMENT ON COLUMN ml_stock_validation_snapshots.execution_time_ms IS 'Time taken to execute the validation in milliseconds';
COMMENT ON COLUMN ml_stock_validation_snapshots.created_at IS 'Timestamp when the validation was executed';
