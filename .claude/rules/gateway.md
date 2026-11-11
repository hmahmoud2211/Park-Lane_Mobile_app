---
paths:
  - "gateway/**"
---

# The CUBE gateway (gateway/)

Python 3.12+ (the image uses 3.14), FastAPI, dependencies pinned in `uv.lock`. Run commands from
`gateway/`. `gateway/README.md` (layout, adding an adapter) and `gateway/API.md` are the source of truth.

- Each module has one job (README "Layout"): `api.py` is the REST API and events under `/api/v1`,
  `gateway.py` wires services, `security.py` holds codes, tokens and rate limits, `devices.py` the
  registry, `discovery/`, `provisioning/` and `relay/` their own areas.
- A device protocol is one module in `cube_gateway/adapters/<name>.py`, a `DeviceAdapter` subclass
  (`adapters/base.py`) with an honest `AdapterInfo` (`verified_models` stays empty until tested on
  hardware). Register it in `adapters/registry.py`, give it a brand in `catalog.py`, and add tests
  under `tests/adapters/` with a protocol mock.
- Dependencies: edit `pyproject.toml`, run `uv lock`, commit both. Check the licence first
  (README "Licences"). Never `pip install` into the project.
- Check: `uv run ruff check cube_gateway tests` and `uv run pytest -q`.
