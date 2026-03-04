"""Download and export ONNX models for the QA service.

Models:
  - Embedder: intfloat/multilingual-e5-small  (384-dim sentence embeddings, multilingual incl. Hebrew)
  - QA:       deepset/xlm-roberta-base-squad2  (extractive QA, multilingual)

Usage:
  pip install -r requirements.txt
  python download-models.py
"""

from pathlib import Path
from optimum.onnxruntime import ORTModelForFeatureExtraction, ORTModelForQuestionAnswering
from transformers import AutoTokenizer

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

EMBED_ID = "intfloat/multilingual-e5-small"
QA_ID = "deepset/xlm-roberta-base-squad2"


def download_embedder():
    out = MODELS_DIR / "embedder"
    if (out / "model.onnx").exists():
        print(f"Embedder already at {out}, skipping")
        return
    print(f"Exporting {EMBED_ID} → {out} ...")
    model = ORTModelForFeatureExtraction.from_pretrained(EMBED_ID, export=True)
    tokenizer = AutoTokenizer.from_pretrained(EMBED_ID)
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    print(f"Embedder saved to {out}")


def download_qa():
    out = MODELS_DIR / "qa"
    if (out / "model.onnx").exists():
        print(f"QA model already at {out}, skipping")
        return
    print(f"Exporting {QA_ID} → {out} ...")
    model = ORTModelForQuestionAnswering.from_pretrained(QA_ID, export=True)
    tokenizer = AutoTokenizer.from_pretrained(QA_ID)
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    print(f"QA model saved to {out}")


if __name__ == "__main__":
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    download_embedder()
    download_qa()
    print("Done.")
