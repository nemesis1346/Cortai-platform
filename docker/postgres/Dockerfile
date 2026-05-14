FROM timescale/timescaledb-ha:pg17

# Ensure PostGIS + pgvector are available alongside TimescaleDB on Postgres 17.
# Note: timescaledb extension is already included in the base image.
USER root
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    postgresql-17-postgis-3 \
    postgresql-17-postgis-3-scripts \
    postgresql-17-pgvector; \
  rm -rf /var/lib/apt/lists/*

USER postgres

