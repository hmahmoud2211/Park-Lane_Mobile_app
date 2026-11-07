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
# uv installs exactly the versions in uv.lock (hash-checked); the same version runs in CI.
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=0 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1
# A compiler only for dependencies that ship no wheel for the target platform (some arm64 builds).
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# Dependencies first, in their own layer, so a code change rebuilds in seconds. --locked fails the build if
# uv.lock no longer matches pyproject.toml, instead of quietly resolving new versions.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --locked --no-install-project
COPY cube_gateway ./cube_gateway
RUN uv sync --locked --no-editable

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
# wg and ip, only for apartments with a tunnel box (cube_gateway/tunnel.py); unused otherwise.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wireguard-tools iproute2 \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin cube \
 && mkdir -p /data \
 && chown cube:cube /data \
 && chmod 0700 /data
COPY --from=build /opt/venv /opt/venv
USER cube
VOLUME ["/data"]
# 8686 the API over HTTP; 8688 the same API over HTTPS once the relay has issued a certificate.
EXPOSE 8686 8688
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["cube-gateway", "healthcheck"]
ENTRYPOINT ["cube-gateway"]
CMD ["serve"]
