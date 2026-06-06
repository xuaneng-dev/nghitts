# Publishing new versions to PyPI

The package is already on [GitHub](https://github.com/nghimestudio/vietnormalizer) and [PyPI](https://pypi.org/project/vietnormalizer/). This guide is for **releasing a new version** to PyPI.

## Prerequisites

- **PyPI account** and **API token** (recommended over password): [pypi.org/manage/account/token/](https://pypi.org/manage/account/token/)
- **Build tools**: `pip install build twine`

## Release steps

### 1. Bump version

Update the version number in **all three** places (keep them in sync):

- `pyproject.toml` → `version = "x.y.z"`
- `setup.py` → `version="x.y.z"`
- `vietnormalizer/__init__.py` → `__version__ = "x.y.z"`

### 2. Build

Clean and build the package:

```bash
rm -rf build/ dist/ *.egg-info
python3 -m build
```

Or use the script (build only, no upload):

```bash
./scripts/build.sh
```

### 3. Upload to PyPI

**Option A – Use the script (recommended)**

```bash
./scripts/publish-to-pypi.sh
```

The script builds if needed, then lets you choose TestPyPI or PyPI and runs twine.

**Option B – Manual**

```bash
# Optional: test on TestPyPI first
python3 -m twine upload --repository testpypi dist/*

# Production
python3 -m twine upload dist/*
```

When prompted:

- **Username:** `__token__`
- **Password:** your PyPI API token (starts with `pypi-`)

### 4. Verify

```bash
pip install vietnormalizer --upgrade
python3 -c "from vietnormalizer import VietnameseNormalizer; print('OK')"
```

## Troubleshooting

| Problem | Solution |
|--------|----------|
| **"File already exists"** | That version is already on PyPI. Bump the version in all three files and rebuild. |
| **403 Forbidden** | Wrong token or username. Use exactly `__token__` and a valid API token. |
| **Missing required files** | Ensure `MANIFEST.in` and `include_package_data=True` in setup.py; run build from repo root. |

## GitHub Actions (optional)

If you use a workflow that publishes on release (e.g. `.github/workflows/publish.yml`):

1. Create a **Release** (tag, e.g. `v0.2.4`) on GitHub.
2. Add secret **`PYPI_API_TOKEN`** in Settings → Secrets and variables → Actions.
3. The workflow runs `twine upload dist/*` for you.

See your workflow file for details.
