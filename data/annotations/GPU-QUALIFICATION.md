# Local GPU reference qualification

Measured on 2026-11-11 and 2026-11-13. **Local GPU execution, provisional
model comparison and bounded cold/resume checks are complete.** DictaBERT
base remains the compatibility default; the tested LLMs do not consistently
beat it across both domains and splits. LLM modes remain opt-in for local
evaluation and review. These measurements do not qualify automatic bulk
publication, particularly for broader article references. No production
import was performed.

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
score and uses less GPU memory. The separate LLM measurements below inform
the default decision; no LLM score is inferred from classifier performance.

## LLM measurements and model choice

Both generative candidates were tested on validation with schema-enforced
retyping and independent detection. Retyping was also checked on development.
The independent detectors had incomplete valid responses on validation and
were not advanced to additional development runs. Every validation case was
attempted; suppressed invalid/held outputs count as missing emitted links.
These are end-to-end pipeline scores, not isolated semantic scores that
exclude protocol failures.

| Split | Domain | Profile | Link precision | Link recall | Link F1 | Strict link F1 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Development | Verse | DictaLM 1.7B retype | 0.641026 | 0.602410 | 0.621118 | 0.583851 |
| Development | Article | DictaLM 1.7B retype | 0.684211 | 0.619048 | 0.650000 | 0.650000 |
| Development | Verse | Qwen3-8B retype | 0.828571 | 0.698795 | 0.758170 | 0.679739 |
| Development | Article | Qwen3-8B retype | 0.647059 | 0.523810 | 0.578947 | 0.578947 |
| Validation | Verse | DictaLM 1.7B detect | 0.000000 | 0.000000 | 0.000000 | 0.000000 |
| Validation | Article | DictaLM 1.7B detect | 0.000000 | 0.000000 | 0.000000 | 0.000000 |
| Validation | Verse | DictaLM 1.7B retype | 0.840000 | 0.797468 | 0.818182 | 0.766234 |
| Validation | Article | DictaLM 1.7B retype | 0.666667 | 0.296296 | 0.410256 | 0.410256 |
| Validation | Verse | Qwen3-8B detect | 0.492308 | 0.405063 | 0.444444 | 0.375000 |
| Validation | Article | Qwen3-8B detect | 0.500000 | 0.407407 | 0.448980 | 0.448980 |
| Validation | Verse | Qwen3-8B retype | 0.853333 | 0.810127 | 0.831169 | 0.766234 |
| Validation | Article | Qwen3-8B retype | 0.333333 | 0.148148 | 0.205128 | 0.205128 |

The model choice has a material tradeoff. Base wins the frozen validation
verses (F1 0.857143), whereas Qwen retyping improves the difficult development
verses (0.758170 versus 0.618182). Base is also strongest on development
articles (0.800000). This does not support replacing the default everywhere
or claiming one universally best Hebrew model from these provisional sets.

On broader validation articles, DictaLM retyping emits 8 correct links out
of 12 rendered predictions against 27 expected mentions. Base has 8/13/27;
Qwen independent detection has 11/22/27. Qwen's higher article F1 therefore
comes with only 50% correct-link precision. Retain the classifier default,
use LLM outputs as review candidates, and require a new human-reviewed
holdout before any automatic model promotion. Retyping still cannot recover
mentions outside the lexical detector's candidate set.

Structured output improves format control, but cannot ensure correct bounds,
non-overlap, target names or semantic types. The retained request counts are:

| Split | Profile | Responses | Valid responses | Invalid responses |
| --- | --- | ---: | ---: | ---: |
| Development | DictaLM retype | 32 | 32 | 0 |
| Development | Qwen retype | 32 | 30 | 2 |
| Validation | DictaLM detect | 42 | 17 | 25 |
| Validation | DictaLM retype | 30 | 30 | 0 |
| Validation | Qwen detect | 42 | 38 | 4 |
| Validation | Qwen retype | 30 | 30 | 0 |

Invalid outputs and their reasons remain in the evidence. They were not
repaired by guessing source coordinates or by changing gold labels.

### Protocol history and exact-response replay

The initial **unconstrained DictaLM** probes failed the strict output
protocol: **0 of 12 responses across 8 contexts** passed validation. An
earlier gate covered only the **first 8 responses across 6 contexts**.
These are protocol-gate observations, not completed semantic
benchmark results. Invalid responses were suppressed; their failure does
not establish the model's semantic precision or recall.

The full semantic comparison was not completed for that unconstrained
configuration. Earlier protocols that required exact surface copying were
replaced with source indices and candidate IDs before the final comparisons.

The revised lean protocol derives source surfaces directly from validated
indices in code. Retyping preserves existing spans using the supplied
candidate ID; independent detection returns original unit indices. The
model no longer has to reproduce niqqud or other exact source bytes in its
response. The final prompt versions are `local-retype-v3` and
`local-detect-v2`, with `target-key-v1` normalization. Their results above
are separate from the initial unconstrained probes.

The `target-key-v1` postprocessor also accepts vocalized model target names
and removes only marks and formatting to produce the target key. It preserves
letters, prefixes and suffixes; it cannot repair a wrong target or entity
type. Source surfaces remain exact. This change has its own cache/provenance
version and does not change prompts, schemas or generation. Earlier actual
GPU responses may therefore be reprocessed on CPU only when their exact
messages, model profile and schema match; captured responses and newly
generated requests must be reported separately. The final archive retains
208 returned responses: 180 newly generated GPU responses and 28 exact
captured Qwen detection responses reprocessed on CPU. No new model call is
attributed to replay. Per-request messages, output hashes, generation
revision and original raw/quarantine proofs make the distinction auditable.

## Hardware and raw runtimes

- NVIDIA GeForce RTX 4070 Laptop GPU, 8,585,216,000 bytes reported VRAM,
  compute capability 8.9; NVIDIA driver 566.07.
- CUDA runtime 12.6; `torch==2.14.1+cu126`, `transformers==5.22.2`.
- Classifiers use explicit `cuda:0`, `float32`; TF32 is disabled.
- Base model: `dicta-il/dictabert-ner`, revision
  `05ed61bc99437b13bc2bdef8154c52f8b44eaad6`.
- Large model: `dicta-il/dictabert-large-ner`, revision
  `ac70130828d5a6811c2dc451e2255424c96f0eb0`.
- Both classifier model cards declare CC-BY-4.0; retain attribution.
- DictaLM: `dicta-il/DictaLM-3.0-1.7B-Instruct`, revision
  `5add44d6941d6ffb9eb6cc6b516f9fb4fd472494`, BF16.
- Qwen: `Qwen/Qwen3-8B`, revision
  `b968826d9c46dd6066d109eabc6255188de91218`, NF4 double quantization with
  BF16 compute and `enable_thinking=False`. Its explicit device map keeps
  the model on CUDA without CPU offload. Both LLM cards declare Apache-2.0.

Both LLM profiles fit the tested 8 GiB GPU. Peak PyTorch CUDA allocation
across the recorded runs was 3461.2 MiB for DictaLM and 6150.5 MiB for Qwen;
these exclude driver/process overhead. BF16 versus NF4 compares deployable
profiles, not parameter count in isolation.

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
LLM report timings additionally mix replay, cache activity and new generation;
their `actual_new_gpu_stats` separate new model work. Do not use these mixed
wall times as a throughput comparison.

A supplemental CPU/GPU consistency comparison initially failed with native
access violation `0xC0000005` in the Windows CUDA-wheel environment during
CPU BERT inference. Explicit eager attention was not a reliable fix and was
not retained. The adapter now rejects that known `torch==2.14.1+cu126` /
Windows / CPU combination before loading weights.

On 2026-11-13, a separate CPU-only environment using `torch==2.15.0+cpu` and
the same `transformers==5.22.2` completed both splits with unmodified model
adapters, FP32, two CPU math threads and one interop thread. CUDA was masked
and remained uninitialized. All aggregate counts, metrics, per-case results
and per-category results matched the base GPU classifier reports exactly
across 40 verse cases and 24 article cases. This establishes equivalence of
these recorded outputs, not arbitrary tensor/logit equality or every input.
The raw CPU reports and comparison are retained under
[`cpu-profile-2-15`](golden/gpu-metrics/cpu-profile-2-15).

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

## Cold/resume publisher checks

All three engines completed real bounded CLI runs and subsequent checkpoint
resumes. Every resumed row file was byte-identical, every source unit was a
checkpoint hit, and no model weights were loaded on resume. Verse surfaces
were checked against canonical segments; article surfaces and content hashes
were checked against the original fixture, including UTF-16 offsets.

| Engine | Input | Source units | Output rows | Warm units computed |
| --- | --- | ---: | ---: | ---: |
| DictaBERT base classifier | First two canonical chapters | 2 | 21 | 0 |
| DictaBERT base classifier | Synthetic article fixtures | 3 | 11 | 0 |
| DictaLM retype | Synthetic article fixtures | 3 | 11 | 0 |
| Qwen independent detection | Synthetic article fixture | 1 | 3 | 0 |

The [pilot manifest](golden/gpu-metrics/publish-pilot/manifest.json) links
the exact row files and cold/warm provenance. Their profile IDs match the
corresponding qualification reports. Retyping evaluation and publication now
share the same execution recipe; older publisher-only profile IDs recompute
instead of silently sharing incompatible checkpoints. These small CLI checks
verify integration and source fidelity; they do not promote an LLM's semantic
accuracy. The article inputs are test fixtures and were never imported.

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

python data/annotations/local_llm.py \
  --model dictalm-3-1.7b-retype --device cuda:0 --dtype bfloat16 \
  --constrained-json --gold-dir data/annotations/golden/validation \
  --cache-dir .cache/llm-requests --out .cache/dictalm-retype-validation.json

python data/annotations/local_llm.py \
  --model qwen3-8b-retype --device cuda:0 --dtype bfloat16 \
  --constrained-json --gold-dir data/annotations/golden/validation \
  --cache-dir .cache/llm-requests --out .cache/qwen-retype-validation.json

python data/annotations/llm_detect.py \
  --model dictalm-3-1.7b-retype --device cuda:0 --dtype bfloat16 \
  --constrained-json --gold-dir data/annotations/golden/validation \
  --cache-dir .cache/llm-requests --out .cache/dictalm-detect-validation.json

python data/annotations/llm_detect.py \
  --model qwen3-8b-retype --device cuda:0 --dtype bfloat16 \
  --constrained-json --gold-dir data/annotations/golden/validation \
  --cache-dir .cache/llm-requests --out .cache/qwen-detect-validation.json
```

For the two development retyping runs, use the same commands with
`--gold-dir data/annotations/golden` and separate output names. Fresh runs
generate every request; the retained Qwen detection report instead separates
28 exact captured responses from 14 new GPU generations. Neither method
changes the semantic scorer or uses gold labels in a prompt.

The readable reports are retained under
[`golden/gpu-metrics`](golden/gpu-metrics). Relative to that root, the measured
files are:

| Report file | Measurements |
| --- | --- |
| `development/dictabert-ner-retype.json` | Base classifier, development split |
| `development/dictabert-large-ner-retype.json` | Large classifier, development split |
| `validation/dictabert-ner-retype.json` | Base classifier, validation split |
| `validation/dictabert-large-ner-retype.json` | Large classifier, validation split |
| `development/dictalm-3-1.7b-retype-json.json` | DictaLM retype, development split |
| `development/qwen3-8b-retype-json.json` | Qwen retype, development split |
| `validation/dictalm-3-1.7b-detect-json.json` | DictaLM independent detection, validation split |
| `validation/dictalm-3-1.7b-retype-json.json` | DictaLM retype, validation split |
| `validation/qwen3-8b-detect-json.json` | Qwen independent detection, validation split |
| `validation/qwen3-8b-retype-json.json` | Qwen retype, validation split |

Each recorded report contains candidate revision, actual device/precision,
runtime versions, GPU details, per-case/category counts and metrics. This
session's reports additionally record the split and gold-file digests in
`qualification.gold_sha256`. Retain the raw reports with the final delivery;
the commands above recreate the measurements and use the same file names.
Routine CI does not fetch model weights or execute these real-model runs.

The [evidence manifest](golden/gpu-metrics/qualification-evidence-manifest.json)
records original and readable-view report hashes and the deterministic, zero-mtime
[`qualification-request-evidence.json.gz`](golden/gpu-metrics/qualification-request-evidence.json.gz)
archive. Decompress it as JSON: each `entries` item stores a portable path,
SHA-256, byte count and base64-encoded exact original bytes. `path_map`
resolves report/evidence references without absolute host paths. The archive
contains complete messages and raw model outputs, original captured and
quarantined responses, validation reasons and unchanged measured reports.
Readable LLM report views label request digests `request_sha256`; only that
metadata label differs from the original `request_key`. This describes the
value accurately and avoids treating a computed digest as an API credential.
The original report bytes stay in the archive, and the manifest records the
exact projection and both hashes. Classifier and CPU reports are unchanged.
`test_qualification_evidence.py` independently checks the hashes, exact
request/model identities, replay/new-generation counts, CPU comparisons and
publisher resume proofs without loading a model.

The byte digests in the original reports are preserved. The Windows
validation input files used CRLF line endings while Git stores LF; their
parsed JSON payloads were checked against the committed labels and are
identical. The companion [`gold-inputs.json`](golden/gpu-metrics/gold-inputs.json)
records the measured byte hashes from the four classifier reports, the committed
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
inference behavior, checkpoint/provenance rules, the recorded lexical
baseline and the integrity of the retained real-model evidence. Model
execution remains a separate local qualification step.
