# Local Tanahpedia reference inference

This offline pipeline generates intended references independently of entry
existence. The website resolves names against live published entries in bulk;
it never invokes a model while rendering. Canonical text and article HTML stay
unchanged. Generation writes local artifacts; import is a separate operation.

## GPU environment

Use an isolated Python 3.12 environment. The tested CUDA 12.6 profile works with
the RTX 4070 Laptop GPU (8 GiB) and NVIDIA driver 566.07:

```powershell
py -3.12 -m venv .cache/annotations-venv
.cache/annotations-venv/Scripts/python -m pip install -r data/annotations/requirements-cuda-cu126.txt
.cache/annotations-venv/Scripts/python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

On Linux use the environment's `bin/python`. Select a PyTorch CUDA build that
supports the installed driver; see the [official wheel matrix](https://pytorch.org/get-started/previous-versions/).
Do not install the CPU-only wheel from the old research commands when intending
to use a GPU. Model snapshots are pinned to full content revisions. Keep the
official `chat_template.jinja` with the tokenizer when prefetching LLM files. Set
`HF_HOME` to a suitable local cache; after download `HF_HUB_OFFLINE=1` makes
the benchmark entirely offline. No paid API or remote inference service is used.

## Reproducible comparison

Keep the existing development cases separate from
[the frozen provisional validation set](golden/validation/README.md). The latter
was labelled before inspecting model outputs and still needs human editorial
review. Neither set supports an unbiased production-accuracy claim.

```powershell
python data/annotations/golden_eval.py --gold-dir data/annotations/golden/validation --out .cache/validation-baseline.json
python data/annotations/encoders.py --model dictabert-ner-retype --model dictabert-large-ner-retype --device cuda:0 --dtype float32 --gold-dir data/annotations/golden/validation --out .cache/encoder-validation
python data/annotations/local_llm.py --device cuda:0 --dtype bfloat16 --gold-dir data/annotations/golden/validation --cache-dir .cache/llm-retype --out .cache/dictalm-retype.json
python data/annotations/llm_detect.py --model qwen3-8b-retype --device cuda:0 --dtype bfloat16 --gold-dir data/annotations/golden/validation --cache-dir .cache/llm-detect --out .cache/qwen-detect.json --rows-out .cache/qwen-detect-rows.json
```

Use `link_precision`, `link_recall` and `link_f1` for model choice: a reference
must have the right span, type AND target name. Detection precision alone can
look strong while linking the wrong referent. Inspect strict metrics, category
results, ordinary-text false positives, invalid-output and abstention counts.
Do not choose a model solely because it produces fewer or more references.

The classifier retypes morphology/gazetteer candidates. `local_llm.py` evaluates
LLM retyping on those same candidates. `llm_detect.py` also evaluates independent
detection, so names outside the gazetteer and all 13 supported entity types can
reach the model. LLMs have no database tools. Output indices, exact source spans,
types and JSON are validated; uncertain/conflicting results remain suppressed.
Existing anchors, scripts and styles are excluded from article annotations.

## Produce resumable local rows

```powershell
python data/annotations/publish.py --device cuda:0 --dtype float32 --pasuk-out .cache/mentions-pasuk.json --checkpoint-dir .cache/mentions-publish
python data/annotations/publish.py --engine llm-detect --llm-model qwen3-8b-retype --device cuda:0 --dtype bfloat16 --max-perakim 1 --pasuk-out .cache/mentions-pilot.json --checkpoint-dir .cache/mentions-pilot
```

Choose `--engine classifier` (the compatibility default), `llm-retype`, or
`llm-detect`. Independent detection does not load a lexical gazetteer.
`--max-perakim` and `--max-articles` bound trial runs; increasing a bound resumes
with new units. Article runs additionally require a verbatim export and
`--articles` plus `--article-out`. Each source unit is checkpointed. Model, detector and
execution settings are recorded so changed inference settings cannot silently
reuse incompatible results. A provenance sidecar accompanies each row file,
including invalid-response diagnostics on both cold and cached runs. A
successful process exit with `complete_valid_responses=false` is an incomplete
generation result and must not be treated as a fully qualified corpus.
CUDA selection fails if unavailable; explicit GPU runs never fall back to CPU.
CPU/float32 remains the default and reduced precision is opt-in. TF32 is disabled
for the classifier's FP32 accuracy comparison.

Inspect generated rows and run the importer with `--dry-run` against a local
database first. Production imports require a separately approved, verified
target and rollback plan. This work does not run a production import.

```powershell
python -m unittest discover -s data/annotations -p 'test_*.py'
python data/annotations/golden_eval.py --check
```

Routine tests use fake inference callables and never download model weights.
