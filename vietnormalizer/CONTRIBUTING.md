# Contributing to vietnormalizer

Thanks for your interest in contributing. Every small fix helps.

## Quick start (fork + small change)

### 1. Fork and clone

1. **Fork** the repo on GitHub: [nghimestudio/vietnormalizer](https://github.com/nghimestudio/vietnormalizer) → click **Fork**.
2. **Clone your fork** (replace `YOUR_USERNAME` with your GitHub username):

   ```bash
   git clone https://github.com/YOUR_USERNAME/vietnormalizer.git
   cd vietnormalizer
   ```

3. **(Optional)** Add the upstream repo so you can sync later:

   ```bash
   git remote add upstream https://github.com/nghimestudio/vietnormalizer.git
   ```

### 2. Quick-win contributions (great first PRs)

These are all valid and welcome:

- **Fix a typo** in `README.md`, docstrings, comments, or `CONTRIBUTING.md`.
- **Fix a typo** in CSV data: `vietnormalizer/data/acronyms.csv`, `vietnormalizer/data/non-vietnamese-words.csv`.
- **Improve wording** in the README or docs (clarity, grammar).
- **Add a missing acronym or word** to the CSV files (same format as existing rows).
- **Fix a broken link** or outdated URL in the repo.

No need to change code for typo-only PRs; just edit the file and open a PR.

### 3. Make your change

- Create a **branch** (optional but nice for anything beyond a single-file typo):

  ```bash
  git checkout -b fix-typo-readme
  ```

- Edit the file(s), save, then:

  ```bash
  git add <file>
  git commit -m "Fix typo in README"   # or a short, clear message
  git push origin main
  ```

  (Use your default branch name if it’s not `main`.)

### 4. Run tests (recommended)

```bash
pip install -e .
python -m pytest test_normalizer.py -v
```

If you only changed docs or CSV content, tests should still pass; running them helps maintain stability.

### 5. Open a Pull Request

1. On GitHub, go to **your fork** → **Pull requests** → **New pull request**.
2. Base: `nghimestudio/vietnormalizer` **main** ← Compare: **your fork** `main` (or your branch).
3. **Title**: short and clear, e.g. `Fix typo in README` or `Fix typo in acronyms.csv`.
4. **Description**: one or two sentences (e.g. “Fixed typo in Quick Start section”).
5. Submit the PR. Maintainers will review when they can.

## CSV format (for dictionary edits)

- **acronyms.csv**: `acronym,transliteration` (e.g. `AI,trí tuệ nhân tạo`).
- **non-vietnamese-words.csv**: `original,transliteration` (e.g. `server,xơ-vơ`).

Keep one entry per line, no extra spaces, and match the existing style.

## What to expect

- Maintainers may suggest small edits in the PR; you can push more commits to the same branch.
- Typo and doc PRs are usually reviewed quickly.
- If the PR is accepted, it will be merged and you’ll be listed as a contributor.

Thank you for contributing.
