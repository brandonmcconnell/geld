#!/bin/sh
set -eu
: "${RELAY_DATABASE_PASSWORD:?Set a separate relay database password}"
psql -v ON_ERROR_STOP=1 --set relay_password="$RELAY_DATABASE_PASSWORD" <<'SQL'
BEGIN;
SELECT 'CREATE ROLE geld_relay LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='geld_relay')
\gexec
ALTER ROLE geld_relay NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
SELECT format('ALTER ROLE geld_relay PASSWORD %L', :'relay_password')
\gexec
ALTER ROLE geld_relay SET default_transaction_read_only=on;
GRANT CONNECT ON DATABASE geld TO geld_relay;
GRANT USAGE ON SCHEMA public TO geld_relay;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM geld_relay;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM geld_relay;
GRANT SELECT(id,kind,host,encrypted_secret,enabled) ON public.relay_channels TO geld_relay;
COMMIT;
SQL
