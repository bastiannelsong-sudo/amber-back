#!/bin/bash

# Script para inicializar certificados SSL con Let's Encrypt
# Ejecutar una sola vez en el servidor antes de docker-compose up

set -e

# Dominios a certificar
domains=(amber.ambernelson.cl api.ambernelson.cl)
rsa_key_size=4096
data_path="./certbot"
email="" # Agregar tu email aquí para notificaciones de renovación

# Verificar si ya existen certificados
if [ -d "$data_path/conf/live/${domains[0]}" ]; then
  read -p "Los certificados ya existen. ¿Deseas reemplazarlos? (y/N) " decision
  if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
    exit
  fi
fi

# Crear directorios necesarios
mkdir -p "$data_path/conf"
mkdir -p "$data_path/www"

# Descargar parámetros TLS recomendados
if [ ! -e "$data_path/conf/options-ssl-nginx.conf" ] || [ ! -e "$data_path/conf/ssl-dhparams.pem" ]; then
  echo "### Descargando parámetros TLS recomendados..."
  mkdir -p "$data_path/conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$data_path/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$data_path/conf/ssl-dhparams.pem"
  echo
fi

# Crear certificado dummy para iniciar nginx
echo "### Creando certificado dummy para ${domains[0]}..."
path="/etc/letsencrypt/live/${domains[0]}"
mkdir -p "$data_path/conf/live/${domains[0]}"
docker compose run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:$rsa_key_size -days 1\
    -keyout '$path/privkey.pem' \
    -out '$path/fullchain.pem' \
    -subj '/CN=localhost'" certbot
echo

# Iniciar nginx con certificado dummy
echo "### Iniciando nginx..."
docker compose up --force-recreate -d nginx
echo

# Eliminar certificado dummy
echo "### Eliminando certificado dummy..."
docker compose run --rm --entrypoint "\
  rm -Rf /etc/letsencrypt/live/${domains[0]} && \
  rm -Rf /etc/letsencrypt/archive/${domains[0]} && \
  rm -Rf /etc/letsencrypt/renewal/${domains[0]}.conf" certbot
echo

# Preparar argumentos para certbot
echo "### Solicitando certificado Let's Encrypt..."

# Construir lista de dominios para certbot
domain_args=""
for domain in "${domains[@]}"; do
  domain_args="$domain_args -d $domain"
done

# Configurar email
case "$email" in
  "") email_arg="--register-unsafely-without-email" ;;
  *) email_arg="--email $email" ;;
esac

# Obtener certificado real
docker compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $email_arg \
    $domain_args \
    --rsa-key-size $rsa_key_size \
    --agree-tos \
    --force-renewal" certbot
echo

# Reiniciar nginx con certificado real
echo "### Reiniciando nginx con certificados reales..."
docker compose exec nginx nginx -s reload
echo

echo "### Certificados SSL configurados exitosamente!"
echo "### Los certificados se renovarán automáticamente."
