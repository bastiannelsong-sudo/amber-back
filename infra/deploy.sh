#!/bin/bash

# Script de despliegue para AWS EC2
# Uso: ./deploy.sh [comando]
# Comandos: setup, start, stop, restart, logs, update, ssl-init

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verificar que existe .env
check_env() {
    if [ ! -f .env ]; then
        log_error "Archivo .env no encontrado. Copia .env.example a .env y configura las variables."
        exit 1
    fi
}

# Configuración inicial del servidor
setup() {
    log_info "Configurando servidor para despliegue..."

    # Actualizar sistema
    sudo apt-get update
    sudo apt-get upgrade -y

    # Instalar Docker
    if ! command -v docker &> /dev/null; then
        log_info "Instalando Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker $USER
        rm get-docker.sh
        log_warn "Docker instalado. Necesitas cerrar sesión y volver a entrar para usar Docker sin sudo."
    else
        log_info "Docker ya está instalado."
    fi

    # Instalar Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_info "Instalando Docker Compose..."
        sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    else
        log_info "Docker Compose ya está instalado."
    fi

    # Crear directorios necesarios
    mkdir -p nginx/conf.d
    mkdir -p certbot/conf
    mkdir -p certbot/www

    log_info "Configuración inicial completada."
    log_info "Próximos pasos:"
    echo "  1. Configura el archivo .env con tus variables"
    echo "  2. Configura tus IPs permitidas en nginx/conf.d/amber.conf"
    echo "  3. Ejecuta: ./deploy.sh ssl-init"
    echo "  4. Ejecuta: ./deploy.sh start"
}

# Inicializar SSL
ssl_init() {
    check_env
    log_info "Inicializando certificados SSL..."
    chmod +x init-letsencrypt.sh
    ./init-letsencrypt.sh
}

# Iniciar servicios
start() {
    check_env
    log_info "Iniciando servicios..."
    docker compose up -d --build
    log_info "Servicios iniciados. Verificando estado..."
    docker compose ps
}

# Detener servicios
stop() {
    log_info "Deteniendo servicios..."
    docker compose down
    log_info "Servicios detenidos."
}

# Reiniciar servicios
restart() {
    log_info "Reiniciando servicios..."
    docker compose restart
    docker compose ps
}

# Ver logs
logs() {
    service=${2:-""}
    if [ -z "$service" ]; then
        docker compose logs -f --tail=100
    else
        docker compose logs -f --tail=100 "$service"
    fi
}

# Actualizar aplicación
update() {
    check_env
    log_info "Actualizando aplicación..."

    # Pull últimos cambios
    git pull origin main

    # Reconstruir y reiniciar
    docker compose up -d --build

    # Limpiar imágenes antiguas
    docker image prune -f

    log_info "Actualización completada."
    docker compose ps
}

# Backup de base de datos
backup() {
    log_info "Creando backup de base de datos..."

    # Crear directorio de backups
    mkdir -p backups

    # Nombre del archivo con timestamp
    backup_file="backups/amber_db_$(date +%Y%m%d_%H%M%S).sql"

    # Ejecutar pg_dump
    docker compose exec -T db pg_dump -U amber amber_db > "$backup_file"

    # Comprimir
    gzip "$backup_file"

    log_info "Backup creado: ${backup_file}.gz"
}

# Restaurar base de datos
restore() {
    backup_file=$2
    if [ -z "$backup_file" ]; then
        log_error "Especifica el archivo de backup: ./deploy.sh restore backups/archivo.sql.gz"
        exit 1
    fi

    log_warn "Esto sobrescribirá la base de datos actual. ¿Continuar? (y/N)"
    read -r decision
    if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
        exit 0
    fi

    log_info "Restaurando base de datos..."

    # Descomprimir si es necesario
    if [[ "$backup_file" == *.gz ]]; then
        gunzip -k "$backup_file"
        backup_file="${backup_file%.gz}"
    fi

    # Restaurar
    docker compose exec -T db psql -U amber amber_db < "$backup_file"

    log_info "Base de datos restaurada."
}

# Estado de los servicios
status() {
    docker compose ps
    echo ""
    log_info "Uso de recursos:"
    docker stats --no-stream
}

# Mostrar ayuda
help() {
    echo "Script de despliegue para Amber"
    echo ""
    echo "Uso: ./deploy.sh [comando]"
    echo ""
    echo "Comandos:"
    echo "  setup     - Configuración inicial del servidor (instala Docker, etc.)"
    echo "  ssl-init  - Inicializar certificados SSL con Let's Encrypt"
    echo "  start     - Iniciar todos los servicios"
    echo "  stop      - Detener todos los servicios"
    echo "  restart   - Reiniciar servicios"
    echo "  update    - Actualizar desde git y reconstruir"
    echo "  logs      - Ver logs (opcional: ./deploy.sh logs [servicio])"
    echo "  backup    - Crear backup de la base de datos"
    echo "  restore   - Restaurar backup (./deploy.sh restore archivo.sql.gz)"
    echo "  status    - Ver estado de los servicios"
    echo "  help      - Mostrar esta ayuda"
}

# Ejecutar comando
case "${1:-help}" in
    setup)    setup ;;
    ssl-init) ssl_init ;;
    start)    start ;;
    stop)     stop ;;
    restart)  restart ;;
    update)   update ;;
    logs)     logs "$@" ;;
    backup)   backup ;;
    restore)  restore "$@" ;;
    status)   status ;;
    help)     help ;;
    *)        log_error "Comando desconocido: $1"; help; exit 1 ;;
esac
