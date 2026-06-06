# Quick Start

## Setup, build and run

**Requirements:** Python 3.8+

1. **Clone and enter the repo**
   ```bash
   git clone https://github.com/nghimestudio/vietnormalizer.git
   cd vietnormalizer
   ```

2. **Create a virtual environment (recommended)**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   ```

3. **Install the project (editable)**
   ```bash
   pip install -e .
   ```

4. **Use it**
   ```python
   from vietnormalizer import VietnameseNormalizer
   n = VietnameseNormalizer()
   print(n.normalize("Hôm nay là 25/12/2023"))
   ```

## Run tests

- **Pytest (automated tests):**
  ```bash
  pip install pytest
  pytest test_normalizer.py -v
  ```

- **Demo script (prints sample normalizations):**
  ```bash
  python test_normalizer.py
  ```

## Releasing to PyPI

To publish a new version, see [docs/publish-to-pypi.md](docs/publish-to-pypi.md) and run `./scripts/publish-to-pypi.sh` from the repo root.
