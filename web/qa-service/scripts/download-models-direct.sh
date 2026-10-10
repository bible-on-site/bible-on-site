#!/bin/bash
# Download pre-exported ONNX models directly from HuggingFace.
# No Python/torch needed — just curl.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODELS_DIR="$SCRIPT_DIR/../models"

# ── Embedder: intfloat/multilingual-e5-small ──
EMBED_DIR="$MODELS_DIR/embedder"
if [ -f "$EMBED_DIR/model.onnx" ]; then
    echo "Embedder already downloaded."
else
    mkdir -p "$EMBED_DIR"
    echo "Downloading embedder ONNX..."
    curl -L -o "$EMBED_DIR/model.onnx" \
        "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/model.onnx"
    curl -L -o "$EMBED_DIR/tokenizer.json" \
        "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/tokenizer.json"
    echo "Embedder saved to $EMBED_DIR"
fi

# ── QA: deepset/xlm-roberta-base-squad2 (ONNX community export) ──
QA_DIR="$MODELS_DIR/qa"
if [ -f "$QA_DIR/model.onnx" ]; then
    echo "QA model already downloaded."
else
    mkdir -p "$QA_DIR"
    echo "Downloading QA ONNX..."
    curl -L -o "$QA_DIR/model.onnx" \
        "https://huggingface.co/onnx-community/xlm-roberta-base-squad2-distilled-ONNX/resolve/main/onnx/model.onnx"
    curl -L -o "$QA_DIR/tokenizer.json" \
        "https://huggingface.co/onnx-community/xlm-roberta-base-squad2-distilled-ONNX/resolve/main/tokenizer.json"
    echo "QA model saved to $QA_DIR"
fi

echo "Done. Models in $MODELS_DIR"
