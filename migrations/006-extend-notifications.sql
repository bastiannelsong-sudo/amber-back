-- Extiende la tabla notifications con columnas de enriquecimiento y estado de lectura

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_type VARCHAR(50) NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS summary TEXT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS product_name VARCHAR(255) NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS seller_sku VARCHAR(100) NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12, 2) NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS currency_id VARCHAR(10) NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS order_id BIGINT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS order_status VARCHAR(20) NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL;

-- Indices para consultas eficientes
CREATE INDEX IF NOT EXISTS idx_notifications_received ON notifications (received DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications (read);
