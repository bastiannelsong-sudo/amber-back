-- Migration: Seed platforms data
-- Description: Actualizar datos de plataformas existentes y agregar Falabella

-- Actualizar Mercado Libre con configuración
UPDATE platforms
SET
  api_base_url = 'https://api.mercadolibre.com',
  is_active = true,
  config = '{"country": "CL", "currency": "CLP"}'::jsonb
WHERE platform_name = 'Mercado Libre';

-- Insertar Falabella si no existe
INSERT INTO platforms (platform_id, platform_name, api_base_url, is_active, config)
VALUES (2, 'Falabella', 'https://sellercenter-api.falabella.com', true, '{"country": "CL"}'::jsonb)
ON CONFLICT (platform_id) DO UPDATE
SET
  api_base_url = EXCLUDED.api_base_url,
  is_active = EXCLUDED.is_active,
  config = EXCLUDED.config;

-- Verificar datos
SELECT platform_id, platform_name, api_base_url, is_active
FROM platforms
ORDER BY platform_id;
