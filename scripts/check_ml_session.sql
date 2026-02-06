-- Verificar si existe sesión activa de Mercado Libre

\echo '🔍 Verificando sesión de Mercado Libre...'
\echo ''

SELECT
  id,
  user_id,
  access_token IS NOT NULL as has_token,
  refresh_token IS NOT NULL as has_refresh,
  LENGTH(access_token) as token_length,
  expires_at,
  CASE
    WHEN expires_at > NOW() THEN '✅ Válida'
    ELSE '❌ Expirada'
  END as status,
  created_at,
  updated_at
FROM sessions
WHERE user_id = 241710025;

\echo ''
\echo 'Si no hay resultados o el token está expirado:'
\echo '1. Ve al frontend → Login → Conectar con Mercado Libre'
\echo '2. Completa el flujo OAuth'
\echo '3. El access_token se guardará automáticamente'
\echo ''
