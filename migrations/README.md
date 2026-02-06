# Database Migrations

Este directorio contiene todas las migraciones de base de datos del proyecto Amber.

## Estructura de Carpetas

Cada migración está organizada en su propia carpeta con el formato:
```
YYYY-MM-DD_nombre_descriptivo/
├── up.sql         # Script para aplicar la migración
├── down.sql       # Script para revertir la migración
├── verify.sql     # Script para verificar que la migración funcionó
└── README.md      # Documentación específica de la migración
```

## Migraciones Disponibles

### 2026-02-05: Stock Validation Cache
**Carpeta:** `2026-02-05_stock_validation_cache/`

Crea la tabla `ml_stock_validation_snapshots` para almacenar en caché los resultados de validación de stock de Mercado Libre, evitando que los usuarios esperen 2-3 minutos cada vez que consultan el estado del stock.

**Archivos:**
- `up.sql` - Crea tabla e índices
- `down.sql` - Elimina tabla e índices
- `verify.sql` - Verifica que todo funciona correctamente

**Ver detalles:** [README de la migración](2026-02-05_stock_validation_cache/README.md)

---

## Cómo Aplicar Migraciones

### Opción 1: Usando psql (recomendado)

```bash
# Navegar a la carpeta del backend
cd "c:\Users\Bastian\Desktop\inversiones amber\repositorios\amber-back"

# Aplicar una migración específica
psql -U postgres -d tu_base_de_datos -f migrations/2026-02-05_stock_validation_cache/up.sql

# Verificar que funcionó
psql -U postgres -d tu_base_de_datos -f migrations/2026-02-05_stock_validation_cache/verify.sql

# Si necesitas revertir
psql -U postgres -d tu_base_de_datos -f migrations/2026-02-05_stock_validation_cache/down.sql
```

### Opción 2: Desde pgAdmin o cliente GUI

1. Abre la carpeta de la migración que quieres aplicar
2. Abre el archivo `up.sql`
3. Copia el contenido
4. Pega en el query editor
5. Ejecuta el script

### Opción 3: Script automatizado (próximamente)

Planeamos crear un script que aplique las migraciones automáticamente en orden.

---

## Orden de Ejecución

Las migraciones deben ejecutarse en orden cronológico según la fecha en el nombre de la carpeta:

1. `2026-02-05_stock_validation_cache/`
   - ✅ Aplicar primero

*(Más migraciones se agregarán aquí en el futuro)*

---

## Buenas Prácticas

1. **Siempre verifica antes de aplicar**: Lee el README de la migración y entiende qué cambios hará
2. **Usa transacciones**: Los scripts incluyen `BEGIN` y `COMMIT` cuando es apropiado
3. **Verifica después de aplicar**: Siempre ejecuta el script `verify.sql` después
4. **Haz backup**: Respalda tu base de datos antes de aplicar migraciones en producción
5. **Documenta cambios**: Cada migración debe tener su README explicando el propósito

---

## Crear una Nueva Migración

Para crear una nueva migración:

1. Crea una carpeta con el formato: `YYYY-MM-DD_nombre_descriptivo/`
2. Dentro, crea los archivos:
   - `up.sql` - Script de migración
   - `down.sql` - Script de rollback
   - `verify.sql` - Script de verificación
   - `README.md` - Documentación
3. Actualiza este README agregando la nueva migración a la lista
4. Asegúrate de que los scripts sean idempotentes (pueden ejecutarse múltiples veces)

---

## Estado de Migraciones

Para ver qué migraciones has aplicado, puedes crear una tabla de control (próximamente):

```sql
-- Tabla para rastrear migraciones aplicadas (opcional)
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Soporte

Si tienes problemas con alguna migración:
1. Revisa el README específico de esa migración
2. Ejecuta el script `verify.sql` para diagnosticar
3. Consulta los logs de PostgreSQL
4. Si necesitas revertir, usa el script `down.sql`
