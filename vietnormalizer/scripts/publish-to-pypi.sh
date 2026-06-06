#!/bin/bash
# Build and publish vietnormalizer to PyPI.
# Run from repository root: ./scripts/publish-to-pypi.sh

set -e

echo "🚀 Publish vietnormalizer to PyPI"
echo ""

echo "🧹 Cleaning previous builds..."
rm -rf build/ dist/ *.egg-info

echo "📦 Building package..."
python3 -m build

echo ""
echo "✅ Build complete. Distribution files:"
ls -lh dist/
echo ""

echo "Select publishing option:"
echo "  1) TestPyPI (test first)"
echo "  2) PyPI (production)"
read -p "Enter choice [1 or 2]: " choice

case $choice in
    1)
        echo ""
        echo "📤 Uploading to TestPyPI..."
        python3 -m twine upload --repository testpypi dist/*
        echo ""
        echo "✅ Uploaded to TestPyPI!"
        echo "🧪 Test install: pip install --index-url https://test.pypi.org/simple/ vietnormalizer"
        ;;
    2)
        echo ""
        echo "⚠️  You are about to publish to PRODUCTION PyPI!"
        read -p "Are you sure? [y/N]: " confirm
        if [[ $confirm =~ ^[Yy]$ ]]; then
            echo ""
            echo "📤 Uploading to PyPI..."
            python3 -m twine upload dist/*
            echo ""
            echo "✅ Published to PyPI!"
            echo "🎉 https://pypi.org/project/vietnormalizer/"
            echo "📥 pip install vietnormalizer"
        else
            echo "❌ Cancelled."
            exit 1
        fi
        ;;
    *)
        echo "❌ Invalid choice. Exiting."
        exit 1
        ;;
esac
