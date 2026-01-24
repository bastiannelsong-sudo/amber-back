-- Migration: Extend platforms table
-- Description: Agregar configuración para integraciones con plataformas

ALTER TABLE platforms
  ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS api_base_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS client_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS client_secret TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS config JSONB;

-- Agregar comentarios
COMMENT ON COLUMN platforms.webhook_url IS 'URL del webhook para recibir notificaciones';
COMMENT ON COLUMN platforms.api_base_url IS 'URL base de la API de la plataforma';
COMMENT ON COLUMN platforms.client_id IS 'ID de cliente para OAuth/API';
COMMENT ON COLUMN platforms.client_secret IS 'Secret de cliente (debe estar encriptado)';
COMMENT ON COLUMN platforms.is_active IS 'Indica si la plataforma está activa';
COMMENT ON COLUMN platforms.config IS 'Configuración adicional específica en formato JSON';
