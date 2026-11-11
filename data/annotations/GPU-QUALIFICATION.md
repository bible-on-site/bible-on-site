# Local GPU reference qualification

Measured on 2026-11-11. **Classifier qualification is complete; final LLM
qualification and the classifier-versus-LLM selection are in progress.**
The tables below contain measured classifier results only. They must not be
read as an LLM comparison or a production-accuracy claim.

Checkpoint remaining work:

- Complete the schema-enforced DictaLM and Qwen validation runs for retyping
  and independent detection in both domains.
- Select the strongest measured profile per domain using correct-link
  metrics, retaining raw responses, failures and generation provenance.
- Validate a bounded cold run and checkpoint resume with the selected current
  profile before recommending a corpus generation command.

The implementation and classifier evidence are pushed for review. No
production import or final LLM model promotion is part of this checkpoint.

## Inputs and scoring

- **Development:** the existing 20 curated verse cases (83 positive
  mentions) and 12 authored article fragments (21 positive mentions and
  17 deliberately suppressed homographs). These are adversarial gap checks,
  already used in model development.
- **Validation:** 20 different canonical verses (79 positive mentions) and
  12 independently authored article fragments (27 positive mentions and
  2 deliberately suppressed homographs). Labels were frozen before model
  outputs were inspected. They cover all 13 supported entity types and
  are explicitly **agent-curated, provisional and not human-reviewed**.
  See [the validation-set protocol](golden/validation/README.md).

Neither split is a random sample of production content. Once validation
outputs have been inspected, a new human-reviewed holdout is needed for a
fresh generalization claim. The annotation vocabulary is independent of
whether a corresponding Tanahpedia entry currently exists.

The primary metrics are **`link_precision`, `link_recall` and `link_f1`**:
an emitted reference must match the exact source span, entity type and
intended target name together. Explicit spelling/type alternatives in the
labels are accepted. `link_f1_strict` accepts only the primary label.
Held/rejected rows do not render and are not correct emitted links.
The older `precision`, `recall` and `f1` measure detection spans alone;
they can be high even when the proposed target is wrong.

## Classifier measurements

Both candidates use the same morphology/gazetteer detection and retype
the resulting candidates; neither can discover a name or category outside
that candidate set. All values are copied from the raw report fields,
without rounding beyond their recorded six decimal places. These reports
were rerun after the `names2` compound-component correction; their hybrid
model revision includes `detecte9a06088`. The measured scores are unchanged
from the previous comparison, while the raw timings below are from this
fresh run.

| Split | Domain | Classifier | Link precision | Link recall | Link F1 | Strict link F1 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Development | Verse | DictaBERT base | 0.621951 | 0.614458 | 0.618182 | 0.581818 |
| Development | Verse | DictaBERT large | 0.609756 | 0.602410 | 0.606061 | 0.557576 |
| Development | Article | DictaBERT base | 0.842105 | 0.761905 | 0.800000 | 0.750000 |
| Development | Article | DictaBERT large | 0.842105 | 0.761905 | 0.800000 | 0.750000 |
| Validation | Verse | DictaBERT base | 0.880000 | 0.835443 | 0.857143 | 0.792208 |
| Validation | Verse | DictaBERT large | 0.826667 | 0.784810 | 0.805195 | 0.753247 |
| Validation | Article | DictaBERT base | 0.615385 | 0.296296 | 0.400000 | 0.350000 |
| Validation | Article | DictaBERT large | 0.538462 | 0.259259 | 0.350000 | 0.350000 |

The corresponding correct-link / rendered-prediction / eligible-gold
counts make the joint metrics independently checkable:

| Split | Domain | Base | Large |
| --- | --- | ---: | ---: |
| Development | Verse | 51 / 82 / 83 | 50 / 82 / 83 |
| Development | Article | 16 / 19 / 21 | 16 / 19 / 21 |
| Validation | Verse | 66 / 75 / 79 | 62 / 75 / 79 |
| Validation | Article | 8 / 13 / 27 | 7 / 13 / 27 |

For example, the base model's validation verse **detection F1 is 0.974026**,
while its correct-link F1 is **0.857143**. On the broader article cases,
its detection recall is 0.407407 and correct-link recall is 0.296296.
The gap includes missed non-biblical names, compound/concept mentions,
held candidates and incorrect typing. Retyping alone cannot remove the
detector's vocabulary ceiling.

DictaBERT base is the stronger classifier in these measurements: it beats
large on verse and broad article validation, ties the development article
score and uses less GPU memory. **The final pipeline choice remains pending
the local LLM retyping and independent-detection results.** No LLM result or
quality threshold has been inferred from classifier performance.

## LLM protocol qualification

The initial **unconstrained DictaLM** probes failed the strict output
protocol: **0 of 12 responses across 8 contexts** passed validation. An
earlier gate covered only the **first 8 responses across 6 contexts**.
These are protocol-gate observations, not completed semantic
benchmark results. Invalid responses were suppressed; their failure does
not establish the model's semantic precision or recall.

The full semantic comparison was not completed for that unconstrained
configuration. The first schema-enforced Qwen protocol likewise failed
validation on most requests because it required the model to copy exact
source surfaces. This is a protocol failure, not a completed semantic
qualification result.

The revised lean protocol derives source surfaces directly from validated
indices in code. Retyping preserves existing spans using the supplied
candidate ID; independent detection returns original unit indices. The
model no longer has to reproduce niqqud or other exact source bytes in its
response. The current prompt versions are `local-retype-v3` and
`local-detect-v2`. **Their schema-enforced qualification and the final model
selection are still in progress.** Their measurements must be recorded
separately; no completed final LLM quality result is claimed here.

The `target-key-v1` postprocessor also accepts vocalized model target names
and removes only marks and formatting to produce the target key. It preserves
letters, prefixes and suffixes; it cannot repair a wrong target or entity
type. Source surfaces remain exact. This change has its own cache/provenance
version and does not change prompts, schemas or generation. Earlier actual
GPU responses may therefore be reprocessed on CPU only when their exact
messages, model profile and schema match; captured responses and newly
generated requests must be reported separately.

## Hardware and raw runtimes

- NVIDIA GeForce RTX 4070 Laptop GPU, 8,585,216,000 bytes reported VRAM,
  compute capability 8.9; NVIDIA driver 566.07.
- CUDA runtime 12.6; `torch==2.14.1+cu126`, `transformers==5.22.2`.
- Explicit `cuda:0`, `float32`; TF32 disabled.
- Base model: `dicta-il/dictabert-ner`, revision
  `05ed61bc99437b13bc2bdef8154c52f8b44eaad6`.
- Large model: `dicta-il/dictabert-large-ner`, revision
  `ac70130828d5a6811c2dc451e2255424c96f0eb0`.
- Both classifier model cards declare CC-BY-4.0; retain attribution.

| Split | Classifier | Recorded verse seconds | Recorded article seconds | Peak CUDA allocation, MiB |
| --- | --- | ---: | ---: | ---: |
| Development | Base | 17.394 | 0.550 | 712.1 |
| Development | Large | 26.699 | 1.176 | 1665.3 |
| Validation | Base | 11.699 | 0.464 | 715.0 |
| Validation | Large | 19.343 | 0.765 | 1665.3 |

These are raw evaluation timings, **not comparable per-verse throughput
or a classifier-versus-LLM speed benchmark**. The encoder harness invokes
the predictor on whole chapters before selecting scored verses; the LLM
harness restricts inference to selected test verses. Repeated chapters,
initialization, allocator state and CPU preparation also differ. Peak CUDA
allocation measures PyTorch allocations, not total process/device usage.

A supplemental CPU/GPU consistency comparison did not complete: the same
Windows CUDA-wheel environment loaded DictaBERT on explicit CPU/FP32, but
terminated with native access violation `0xC0000005` during BERT forward
execution. One diagnostic retry with a Python fault trace confirmed the
forward-path failure. CUDA was masked for both attempts, and no complete CPU
split was produced. The tables above remain actual GPU measurements; they
do not establish prediction equivalence with CPU. This observation is scoped
to the tested Windows environment, not every CPU installation.

## Source alignment and target-name audit

The deterministic source stage was audited independently of the neural
models across the full scripture corpus:

- 35,168 emitted decoration rows retain the exact canonical surface bytes
  and text-bearing source spans; zero incorrect emitted surfaces.
- Of 35,896 morphology tokens, 35,881 align to canonical source words:
  35 recover a unique in-verse surface match after a positional mismatch,
  and 15 abstain. No fuzzy spelling or cross-verse relocation is used.
- 365 intended names previously contained morphology suffix separators
  or zero-width characters. The new normalization removes those defects
  using attested clean forms from the same pinned lemma data, with a
  directive-suffix/final-letter fallback. Unattested uncertain suffixes
  remain held, including when their names enter the article gazetteer.
- A subsequent compound audit found 7 repeated-component names caused by
  pooling morphology IDs across different parts of a compound. Normalization
  now retains the component's `+` marker: `בראשית כח ב` produces `פדן ארם`
  rather than `ארם ארם`. The repeated-component count fell from 7 to zero
  across the same 696 compound rows; source surfaces and row counts did
  not change.
- No canonical text, stored article HTML or existing entry data was
  rewritten. The detector revisions are
  `morphhb-lexical-baseline@3d15126f+aligned2+names2+contract1` and
  `morphhb-gazetteer@3d15126f+aligned2+names2+contract1`.

These invariants prevent source-offset and malformed-name errors; they
do not establish that every detected mention has the correct semantic type.

## Reproduction and raw reports

Run from the repository root using an isolated environment installed with
[the tested CUDA profile](requirements-cuda-cu126.txt). Activate that
environment first, so `python` below names its interpreter. Downloads are
local model snapshots; there is no paid API or remote inference service.
The commands do not import generated rows into a database.

```bash
python data/annotations/encoders.py \
  --model dictabert-ner-retype --model dictabert-large-ner-retype \
  --device cuda:0 --dtype float32 \
  --gold-dir data/annotations/golden \
  --out .cache/gpu-metrics/development

python data/annotations/encoders.py \
  --model dictabert-ner-retype --model dictabert-large-ner-retype \
  --device cuda:0 --dtype float32 \
  --gold-dir data/annotations/golden/validation \
  --out .cache/gpu-metrics/validation
```

The raw classifier reports are retained under
[`golden/gpu-metrics`](golden/gpu-metrics). Relative to that root, the measured
files are:

| Report file | Measurements |
| --- | --- |
| `development/dictabert-ner-retype.json` | Base classifier, development split |
| `development/dictabert-large-ner-retype.json` | Large classifier, development split |
| `validation/dictabert-ner-retype.json` | Base classifier, validation split |
| `validation/dictabert-large-ner-retype.json` | Large classifier, validation split |

Each recorded report contains candidate revision, actual device/precision,
runtime versions, GPU details, per-case/category counts and metrics. This
session's reports additionally record the split and gold-file digests in
`qualification.gold_sha256`. Retain the raw reports with the final delivery;
the commands above recreate the measurements and use the same file names.
Routine CI does not fetch model weights or execute these real-model runs.

The byte digests in the original reports are preserved. The Windows
validation input files used CRLF line endings while Git stores LF; their
parsed JSON payloads were checked against the committed labels and are
identical. The companion [`gold-inputs.json`](golden/gpu-metrics/gold-inputs.json)
records the measured byte hashes from all four reports, the committed
byte hashes, canonical parsed-JSON hashes and the exact commit checked.
Folder-local Git attributes preserve raw report bytes when they are staged.
For a cross-platform label check, hash UTF-8 JSON serialized with
`ensure_ascii=False`, `sort_keys=True` and `separators=(",", ":")`:

| Split | Label file | Canonical parsed-JSON SHA-256 |
| --- | --- | --- |
| Development | `pesukim.json` | `b9ebf2664ccea9cb3ef51cab0fd9ff4f58a9d5f9f264177456e3be81227615a8` |
| Development | `articles.json` | `9b7afc1a3affa1ca45037ce5d0ce13d279468ef467c99947636e4bdfe84b8138` |
| Validation | `pesukim.json` | `4ee1fda3ea292f3d310b1af0dbd3c851c8af20117c608455593544ec74f7c9e4` |
| Validation | `articles.json` | `6704c5c5632a0d340cfca528010d6e41d9e2f66b2e904c034e6ea4a9ef9a122c` |

The existing annotation CI stage runs:

```bash
python -m unittest discover -s data/annotations -p 'test_*.py'
python data/annotations/golden_eval.py --check
```

Those checks validate source alignment, span contracts, fake-provider
inference behavior, checkpoint/provenance rules and the recorded lexical
baseline. They are separate from the real GPU evidence above and from
the pending final LLM qualification.
