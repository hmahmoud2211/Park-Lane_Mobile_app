# syntax=docker/dockerfile:1.7
#
# CUBE Gateway: one self-contained image (API, discovery, adapters, SQLite). Run it with host networking so
# mDNS, SSDP and vendor UDP broadcasts reach the home network:
#
#   docker run -d --name cube-os-gateway --network host --restart unless-stopped \
#     -v cube-os-data:/data ghcr.io/hmahmoud2211/cube-os-gateway:latest
#
# First start creates the database and keys in /data and prints a setup code: docker logs cube-os-gateway

ARG PYTHON_VERSION=3.14

FROM python:${PYTHON_VERSION}-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# A compiler only for dependencies that ship no wheel for the target platform (some arm64 builds).
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# Dependencies first, in their own layer, so a code change rebuilds in seconds.
COPY pyproject.toml README.md ./
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && mkdir cube_gateway && touch cube_gateway/__init__.py \
 && /opt/venv/bin/pip install . \
 && rm -rf cube_gateway build *.egg-info
COPY cube_gateway ./cube_gateway
RUN /opt/venv/bin/pip install --no-deps --force-reinstall . \
 && /opt/venv/bin/python -m compileall -q /opt/venv/lib

FROM python:${PYTHON_VERSION}-slim
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="CUBE Gateway" \
      org.opencontainers.image.description="Local-first smart home discovery, provisioning and control for CUBE OS" \
      org.opencontainers.image.source="https://github.com/hmahmoud2211/Park-Lane_Mobile_app" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    CUBE_DATA_DIR=/data \
    CUBE_PORT=8686
RUN useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin cube \
 && mkdir -p /data \
 && chown cube:cube /data \
 && chmod 0700 /data
COPY --from=build /opt/venv /opt/venv
USER cube
VOLUME ["/data"]
EXPOSE 8686
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["cube-gateway", "healthcheck"]
ENTRYPOINT ["cube-gateway"]
CMD ["serve"]
