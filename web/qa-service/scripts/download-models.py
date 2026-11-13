"""Download and export ONNX models for the QA service."""
# Models:
#   - Embedder: intfloat/multilingual-e5-small  (384-dim sentence embeddings, multilingual incl. Hebrew)
#   - QA:       deepset/xlm-roberta-base-squad2  (extractive QA, multilingual)
#
# Usage:
#   pip install -r requirements.txt
#   python download-models.py

from pathlib import Path
from optimum.onnxruntime import ORTModelForFeatureExtraction, ORTModelForQuestionAnswering
from transformers import AutoTokenizer

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

EMBED_ID = "intfloat/multilingual-e5-small"
EMBED_REV = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
QA_ID = "deepset/xlm-roberta-base-squad2"
QA_REV = "a5fab9908c8d856e8c583fd41ba6d92444e46477"


def download_embedder():
    out = MODELS_DIR / "embedder"
    if (out / "model.onnx").exists():
        print(f"Embedder already at {out}, skipping")
        return
    print(f"Exporting {EMBED_ID} → {out} ...")
    model = ORTModelForFeatureExtraction.from_pretrained(EMBED_ID, revision=EMBED_REV, export=True)
    tokenizer = AutoTokenizer.from_pretrained(EMBED_ID, revision=EMBED_REV)
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    print(f"Embedder saved to {out}")


def download_qa():
    out = MODELS_DIR / "qa"
    if (out / "model.onnx").exists():
        print(f"QA model already at {out}, skipping")
        return
    print(f"Exporting {QA_ID} → {out} ...")
    model = ORTModelForQuestionAnswering.from_pretrained(QA_ID, revision=QA_REV, export=True)
    tokenizer = AutoTokenizer.from_pretrained(QA_ID, revision=QA_REV)
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    print(f"QA model saved to {out}")


if __name__ == "__main__":
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    download_embedder()
    download_qa()
    print("Done.")
