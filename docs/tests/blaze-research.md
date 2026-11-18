# Blaze benchmark research (issue #3602)

Research record for [indexable-inc/blaze](https://github.com/indexable-inc/blaze):
what it is, what it does on BibleOnSite's Rust crates, and whether adopting it
would pay off. Written 2026-11-17 against master `0e6f392a2` and upstream docs at
`c54fc993e6f2128062ee657190baa867c500182e`.

**Recommendation up front: retain Cargo. Do not adopt Blaze for CI or release
paths today.** The single measured blocker is enough on its own — the current
stable release cannot compile our API crate or run any `cargo test` equivalent —
and the architecture's benefits do not map onto where our Rust time is spent.
Details and re-evaluation triggers below.

## 1. What Blaze is

Blaze (formerly `ra-jit`, YC F26, MIT/Apache-2.0) is a resident-compilation
daemon that replaces cargo+rustc rather than wrapping them. Its front end is
built on rust-analyzer's analysis and MIR; codegen is Cranelift (dev profile) or
a bundled LLVM 23 fork (`BLAZE_BACKEND=llvm`, release profile); incremental
state is managed by salsa; linking is its own linker. You type `blaze` where you
would type `cargo`, but only for `build`, `check`, `run`, `test`, `bench` —
every other cargo subcommand (`clippy`, `fmt`, `doc`, `llvm-cov`, `nextest`,
`release`, ...) fails with `no such command`.

Two generations exist, and conflating them is the main way this research goes
wrong:

| | v1 | v2 |
|---|---|---|
| Channel | `stable` (installer default) — installed **0.20261027.0** | `canary` — installed **0.20261105.4** (bootstrap, cargo-built) |
| Model | keeps rustc's executable and splices patches into it; hands cold builds/edits it cannot do to cargo+rustc | no cargo/rustc at all: own front end, own store, own linker |
| Benchmarks | published: ~10× macOS arm64, ~24× Linux aarch64, ~11× Linux x86-64 mean on single-function edits | **none published** (upstream says so explicitly) |
| Live edits | yes (macOS arm64) | not yet |

The published "up to 92×"/"10–24×" numbers are all v1's, measured on
single-function edits after a warm daemon. Our experiment used the stable
channel (v1, `0.20261027.0`) and attempted canary (v2, `0.20261105.4`).

### Hard environment requirements (v2-era installer)

- macOS Apple silicon **or** Linux x86-64/ARM64 with **glibc ≥ 2.34**. Alpine and
  other musl systems are refused by the installer.
- Windows: no build, installer refuses (v1's MSVC port was hand-run, never in
  CI).
- A C compiler for linking (`gcc`/`cc`).
- `io_uring` on Linux — v2's build engine does its I/O on io_uring and cannot
  start without it (kernel ≥ ~5.1 with `CONFIG_IO_URING`; Docker's default
  seccomp profile on Docker 25+ also refuses it unless relaxed).
- Sandboxed build scripts/proc macros need user namespaces **or** Landlock;
  else `BLAZE_SANDBOX=off` runs them unconfined (as cargo does).
- Memory: upstream documents "a few GB for a small project, tens of GB for the
  largest"; our observations below match.
- Its own toolchain: `blaze-2026-10-27` (Rust nightly of that date, ~159 MB on
  Linux, downloaded to `~/.blaze/toolchains`), used **whatever the project
  pins** — rust-toolchain files, `RUSTUP_TOOLCHAIN` and our pinned stable are
  ignored. The project's toolchain "stays the final word" by upstream's own
  wording.

## 2. BibleOnSite's Rust surface (inventory)

| Workspace | Profile of the code | CI entry points |
|---|---|---|
| `web/api` | edition 2024; actix-web 4, async-graphql 7 (proc-macro heavy), SeaORM/sqlx MySQL, native-tls (openssl-sys build script), `entities` path dep, `include_str!` into `web/shared/` and **`data/mysql/*.sql` from test code** | `api_e2e` job: `cargo make lint` (clippy), `coverage-unit` = `cargo llvm-cov test` + `cargo llvm-cov nextest`, `cargo llvm-cov run` instrumented e2e binary, real-MySQL ignored-suite nextest runs |
| `web/bulletin` | edition 2024; lambda_http, typst-as-lib + typst-pdf (very large pure-Rust dep tree), SeaORM; release `opt-level=z + lto + strip` | `bulletin_ci`: clippy `-D warnings`, fmt, `llvm-cov test` + nextest junit; `package_bulletin`: `cargo build --locked --release` inside `rust:1.100.0-alpine` (musl) Docker |
| `data` | edition 2024 workspace, 8 members; mongodb (aws-lc-rs/ring via rustls), rusqlite **bundled** (C compile via `cc`), sqlx, AWS SDK, icu/sunrise | `data_ci`: clippy `--all-targets --all-features -D warnings`, fmt, `llvm-cov nextest --workspace` unit + `--features integration`; `perushim_data`: `cargo run --release` generation pipelines; `build_sefaria_mongo_docker` (image only) |
| `web/api`+`bulletin` packaging | musl static release builds inside `rust:1.100.0-alpine` Docker, linux/amd64 **and** linux/arm64 | `package_api` / `package_api_arm64` via shared-dockerize; `release_*` jobs re-tag |

Toolchain reality: CI pins `dtolnay/rust-toolchain@stable` (1.100.x era) on the
host and `rust:1.100.0-alpine` in Dockerfiles; caches are `Swatinem/rust-cache`
per job + `sccache` (`RUSTC_WRAPPER`) on every Rust job.

### Measured CI Rust fractions (job step timings, this week)

| Job (run) | Total | Rust-compile/test share | Share of job |
|---|---|---|---|
| API CI (#44123946334, job 134182821456) | 407s | clippy 53s + coverage-unit 177s + MySQL cov 7s + e2e (incl. instrumented-server build) 76s | ~77% |
| Bulletin CI (job 134182821404) | 500s | clippy 90s + coverage-unit 348s | ~88% |
| Data CI (job 134073372181) | 784s | clippy 147s + unit cov 167s + integration cov 211s | ~67% |
| Perushim Data (job 133988225034) | 651s | `cargo run --release` ×2: 151s + 110s (build + Mongo pipeline runtime) | ~40% |
| Package API / ARM64 (#44123946334) | 650s/630s | dockerized `cargo build --release` musl ×2 | ~95% |
| Package Bulletin (job 133918735396) | 549s | dockerized `cargo build --release` musl 497s | ~91% |

The important shape: **our Rust CI time is coverage-instrumented test builds,
clippy, and dockerized musl release builds — none of which are commands Blaze
implements.** The interactive "edit → check/test" loop where Blaze's wins live
is a *local development* path, and it does not appear in CI except as
cold/warm one-shot builds on ephemeral runners (no persistent daemon).

## 3. Experiment

### Environment

- Host: Windows, **no Virtual Machine Platform** → no WSL2, no working Docker
  Desktop Linux engine. Blaze v2 cannot run: its daemon dies instantly with
  `io_uring_setup failed with ENOSYS` (WSL1's 4.4-emulated kernel has no
  io_uring). This itself is a data point — see §5.
- Test env: WSL1 Ubuntu 24.04, kernel `4.4.0-19041-Microsoft`, glibc 2.39,
  gcc 13.3, 12 cores, 31 GB RAM; `BLAZE_SANDBOX=off` (no userns/Landlock).
- Baseline: rustup **rustc/cargo 1.100.0 stable** — the same version family our
  Dockerfiles pin (`rust:1.100.0-alpine`).
- Installed: blaze `0.20261027.0` (stable, `49ca152`) — v1 architecture
  (`ra-jit` binaries); canary `0.20261105.4` (`e930296`) — v2, downloaded as
  tarball and sha256-verified (`a8b8f3b3…`), installed via `BLAZE_ARCHIVE` after
  the installer's HTTP/2 download failed under WSL1.
- Sources: exact copies of `web/api` (+`entities`, `web/shared`, `data/mysql`
  for test `include_str!`), `web/bulletin`, `data` workspace, and a standalone
  copy of `data/reading-metrics` (de-workspaced manifest) under the Linux
  filesystem.

### Measured results — `web/api` (62 files, ~30k lines, ~350 crates)

| Scenario | cargo 1.100.0 | blaze v1 0.20261027.0 |
|---|---|---|
| `build` cold (deps fetched) | 2m16.6s | **FAIL** — 15m57s, then `error: api reaches functions blaze could not compile … writable static __RUST_STD_INTERNAL_VAL without a rustc symbol` |
| `build` warm, no change | 2.7s | n/a (never reached a successful build) |
| `build` after 1-function body edit | 29.2s | n/a |
| `build` after signature change (`bad_request` → `impl AsRef<str>`, 110 call sites) | 32.8s | n/a |
| `build` after `SimpleObject` field add (async-graphql generated code, 5 ctor sites) | **2m19s** (near cold-build cost) | n/a |
| `test` (build test bins + run; 520 pass, 5 ignored MySQL) | 2m12s | n/a — and `test` is separately broken, see below |
| `check` cold (dep store already warm from failed build) | 2m21s first `cargo check` | **4m01s — PASS** |
| `check` after 1-function body edit | 12.5s | **1.68s — PASS (~7.5× faster)** |
| `build --release` cold | 6m54.9s | n/a |

Blaze daemon state during the api attempt: worker peaked at **8.0 GB RSS**,
daemon advertises "workers hold at most 16339 MB"; after four checkout
attempts the on-disk store was **6.5 GB** (`blaze cache gc` collects it).

### Measured results — `data` workspace (8 members)

| Scenario | cargo 1.100.0 | blaze v1 |
|---|---|---|
| `build --workspace` cold | 12m13s | **FAIL** — 4m39s, `aws-lc-sys v0.45.0` **build script** hits the same `__RUST_STD_INTERNAL_VAL` wall before any member compiles |

### Measured results — `web/bulletin` (typst dep tree)

| Scenario | cargo 1.100.0 | blaze v1 |
|---|---|---|
| `build` cold | (CI reference: 497s musl release in docker) | **FAIL** — 22m30s, worker peaked ≈12.6 GB RSS, then the same `__RUST_STD_INTERNAL_VAL` refusal through `main`'s async chain |

### Measured results — small crates

| Scenario | cargo 1.100.0 | blaze v1 |
|---|---|---|
| `toy` hello-world `build` cold / edit | ~1s | 7.9s / **0.78s** (splice works) |
| `reading-metrics` standalone `build` cold / body edit | ~10s / ~2–4s | 10.0s / **0.20s** (splice works on real code) |
| `reading-metrics` `blaze test` | `cargo test` ~2–5s | **FAIL** — libtest's own `test::test_main_inner` reaches `__RUST_STD_INTERNAL_VAL`; **the test harness itself cannot be built** |

### What the failure is

`__RUST_STD_INTERNAL_VAL` is a writable static inside the standard library
reachable from threaded closures — `cc`'s jobserver thread, async
`collect`/`iter` chains, and libtest's spawn hook all monomorphize it. Blaze v1
cannot compile it and does not fall back (upstream
[#1643](https://github.com/indexable-inc/blaze/issues/1643), open). In
practice this makes v1 unable to **build** async-heavy application code and
unable to **test** anything — the two operations our Rust workflow depends on.

## 4. Compatibility matrix (this repo's workloads vs blaze today)

| Capability | v1 stable 0.20261027.0 | v2 canary 0.20261105.4 | Repo impact |
|---|---|---|---|
| `web/api` build/test | **FAIL** (build: unsupported static; test: harness unbuildable) | untested — cannot run on this host | `cargo make coverage-unit`, `test` |
| `data` workspace build/test | **FAIL** (aws-lc-sys build script) | untested | `cargo make coverage-unit`, pipelines |
| `web/bulletin` build | **FAIL** — 22m30s / ≈12.6 GB RSS, same unsupported static | untested | `bulletin_ci`, `package_bulletin` |
| `reading-metrics` lib build | PASS | untested | shows ceiling is low-complexity code |
| `reading-metrics` test | **FAIL** (libtest) | untested | every `cargo test` path |
| `check` (api) | PASS — 1.68s after edit (~7.5× vs `cargo check` 12.5s) | untested | only plausible local-dev use |
| `clippy`, `fmt`, `doc`, `llvm-cov`, `nextest`, `cargo-make`, `cargo-release` | **not implemented** (exit `no such command`; upstream [#1685](https://github.com/indexable-inc/blaze/issues/1685) for nextest) | same | 100% of our Rust CI steps |
| musl target (`x86_64-unknown-linux-musl`) | installer refuses musl **hosts**; v1 had a cross-compile case; v2 unknown | same | API/bulletin release images |
| Windows host | no build; installer refuses | same | primary dev machines here |
| Linux container / CI | namespaces-or-Landlock needed else `BLAZE_SANDBOX=off`; v2 needs io_uring (Docker 25+ default seccomp refuses) | hard `io_uring` requirement | dockerized builds need `--security-opt seccomp=unconfined` + glibc image (ours are Alpine/musl) |
| `--release` correctness/parity | v1 release = LLVM `-O2` fast-isel; upstream P0: no inlining → **produced binaries are slower** ([#1845](https://github.com/indexable-inc/blaze/issues/1845)) | v2 not release-comparable by design (Cranelift dev / LLVM non-inlining) | `cargo run --release` pipelines, packaging |
| proc macros | compiled to wasm32-wasip1 in sandbox; mostly works (async-graphql, serde built during our api attempt) | wasm sandbox + `derive_more` regression ([#1722](https://github.com/indexable-inc/blaze/issues/1722)) | api is macro-heavy — the parts that did build were fine |
| `build.rs` + `cc` (openssl-sys, aws-lc-sys, rusqlite bundled) | partial: openssl-sys succeeded; **aws-lc-sys failed**; purity-analysis bugs ([#2179](https://github.com/indexable-inc/blaze/issues/2179), [#2180](https://github.com/indexable-inc/blaze/issues/2180)) | sandbox model rewritten | native-dep crates |
| borrow checking | none in 0.1.0; ~2/3 of rustc's on current main | partial | a `blaze check` pass is not a `cargo check` pass — needs cargo as final word regardless |
| Cargo.lock parity | reads lockfile/workspace metadata | reads lockfile | `--locked` used in packaging |
| workspace path deps, `include_str!` outside package | api `entities` path dep + `../shared` include worked during check | — | our layout is fine |
| multi-arch (arm64 linux) | v1 ran aarch64; v2 unmeasured | — | `package_api_arm64` |

## 5. Where Blaze could and could not accelerate us

**Addressable in principle (local dev loop on macOS/Linux):** `blaze check`
after a one-function edit measured **1.68s vs `cargo check` 12.5s** on web/api —
a ~7.5× edit-loop gain, consistent with upstream's v1 claims. That is the
*only* measured gain on our code, and it is a "faster partial answer": blaze
check passes code blaze cannot build (our api) and misses ~1/3 of rustc's
borrow errors, so `cargo check` must still run before trust.

**Not addressable (structurally):**

- Every CI Rust step is `clippy`/`fmt`/`llvm-cov`/`nextest` — commands blaze
  does not implement. Substituting `blaze test` for `cargo test` in those jobs
  would lose coverage instrumentation, JUnit reports, nextest scheduling, and
  the `-D warnings` lint gate — i.e., the jobs' actual purpose.
- Ephemeral CI runners get a cold daemon each run: install (~186 MB + 159 MB
  toolchain), dep-compile at ≈cargo cost (or worse, serially), then the job
  ends — the incremental engine never pays off. Blaze needs persistent
  workers/runners to amortize, which is a different runner topology with a
  resident-daemon memory budget (observed 8–11 GB per checkout worker).
- Release/packaging: musl host unsupported, Alpine images can't install it,
  io_uring blocked by default container seccomp, and the produced binaries are
  slower (no inlining — upstream P0). Our two heaviest Rust jobs
  (`package_api` amd64+arm64, `package_bulletin`) are exactly this case.
- Windows dev machines: no build at all. Our devs are on Windows; WSL1 lacks
  io_uring (v2 dead) and virtualization is off (no WSL2/Docker) — v1 limps on
  WSL1 but fails on our real crates.
- `data` pipelines' `cargo run --release`: the binary's runtime dominates
  after the first build; a non-inlining release backend would make the
  MongoDB-bound pipeline *slower*, not faster.

**End-to-end estimate if v2 magically worked tomorrow:** zero on current CI
(no addressable steps); possibly minutes/day on local `cargo check`-equivalent
feedback for a developer on macOS/Linux — contingent on v2 actually compiling
our crates, which is unproven (and on this hardware, untestable).

## 6. Risk register

| # | Risk | Severity | Likelihood | Evidence / mitigation |
|---|---|---|---|---|
| R1 | Blaze cannot compile our flagship crates (api, data) or any test binary | **Critical** | **Observed** (v1, twice + libtest) | `__RUST_STD_INTERNAL_VAL`; upstream #1643. No mitigation in v1 — failure is final, no rustc fallback |
| R2 | `test`/`clippy`/`fmt`/`llvm-cov`/`nextest` absent → CI gates can't move | Critical | Observed (documented + measured) | Would need upstream nextest/llvm-cov support; keep cargo authoritative |
| R3 | Own nightly toolchain replaces pinned stable/1.100 — build behavior drift, `#![feature]` availability, ABI | High | Certain if adopted | Docs: blaze ignores rust-toolchain pins; mitigate only by treating cargo output as authoritative |
| R4 | Memory footprint: 8–11+ GB RSS per checkout worker observed; upstream documents "tens of GB" worst case; daemon does not self-exit (1800s idle) | High | Observed | `blaze stop` + idle timeout; on 16 GB runners, 2 checkouts ≈ OOM risk; #1726 shows a 169 GB daemon bug |
| R5 | Correctness of produced code: partial borrow checker; upstream open issues for miscompiles/panics (Cranelift blockorder #1675, wasm proc-macro fault #1722, splice/link #1663) | High | Medium | Keep cargo builds/tests as the gate; never ship blaze-built artifacts |
| R6 | Ephemeral CI economics negative: install+fetches+cold-compile each run, daemon discarded | Medium | Certain | Only persistent runners amortize; that is an infra change + memory budget, not a drop-in |
| R7 | Release/musl/multi-arch/docker paths unsupported or blocked (musl host refused, io_uring vs container seccomp, no inlining) | High | Observed/documented | None today; release pipeline stays on cargo+rust:alpine |
| R8 | Young project, single vendor (YC F26), channel semantics shifting: stable still ships v1 while v2 canary rewrites the engine; all published numbers are v1's | Medium | Observed | Version-pin (`[workspace.metadata.blaze] version`), re-evaluate on v2 stable + published v2 benchmarks |
| R9 | Supply chain: installer pipes `ix.dev` script; toolchain + release tarballs from `blaze-releases.ix.dev` (R2) with sha256 checks — we verified ours; but a third-party compiler in the build path expands trust surface (build scripts see env/secrets in CI) | Medium | Medium | `BLAZE_SANDBOX=off` runs build scripts unsandboxed (as cargo); sandbox mode needs kernel features. If ever piloted: pin release sha, `BLAZE_RELEASES` mirror, no prod secrets in build env |
| R10 | Telemetry/update checks: daemon polls `latest.json` every 5 min; update mode `off`/`offline` configurable | Low | Documented | Set `[update] mode = "offline"` in any pilot |
| R11 | WSL1/container constraints we hit (io_uring, userns, FICLONE issue #1781) — environment-specific failure modes | Medium | Observed | None local; document |
| R12 | Unverified areas: v2 on anything (no CI, no benchmarks), musl, arm64, long-running daemon stability, state restore across restarts, `-Z`/RUSTFLAGS handling | ? | Open | All pending upstream; no evidence available |

## 7. Maintenance and cost estimate if adopted anyway

- Additional toolchain lifecycle: blaze's nightly pin (`blaze-<date>`), its
  release channel (dated `0.YYYYMMDD.N`, yank warnings), workspace
  `[workspace.metadata.blaze]` pins — a second compiler to track, on top of
  cargo/rustup and our `rust:1.100.0` image pins.
- Persistent-runner infra to amortize the daemon (self-hosted or cache the
  `~/.blaze` + store state; store alone measured ~1.7 GB/checkout, RAM is the
  binding constraint, not disk).
- CI complexity: parallel cargo path must remain authoritative for lint,
  coverage, nextest, packaging — blaze would only ever be an *added* lane, so
  job time is additive, not subtractive.
- Upstream churn: 432 open issues, ~7.3k commits in ~3 months, daily toolchain
  bumps, v1→v2 rewrite in-flight — a fast-moving target to re-verify at each
  bump.
- License: MIT/Apache-2.0 — no blocker. Vendor is pre-1.0 startup; remote/CI
  commercial offerings exist but nothing measured here needs them.

## 8. Decision

**Retain Cargo. No adoption** — not CI, not release, not even a local-only
recommendation on this codebase today, because the crates we actually iterate
on (api) fail to build and nothing can be tested under v1, while v2 cannot run
on our dev machines and has no published numbers.

Re-evaluate when **all** of these hold:

1. v2 reaches the stable channel **with published v2 benchmarks** on real
   projects (upstream's own bar), including a release-build parity story
   (inlining fix, #1845).
2. Upstream fixes the std-internal unsupported-function class (#1643) and
   libtest can run under `blaze test` — our api then becomes a real candidate
   for an edit-loop pilot on a macOS/Linux dev machine.
3. `nextest` + coverage support exists (#1685) or a CI lane is designed that
   keeps cargo-llvm-cov/nextest authoritative while blaze only pre-builds.
4. Windows hosts are either supported or devs are on WSL2/containers with
   io_uring and user namespaces — i.e., our actual dev hardware can run it.

If re-evaluating: pin a release, run the same matrix in this document on a
kernel-≥6.0 Linux box with 32+ GB RAM, and gate any local-only pilot behind
`cargo check` + `cargo test` as the final word — which is also upstream's
documented advice.

## Appendix — reproduction

```bash
# env: Ubuntu 24.04 (glibc 2.39), gcc, pkg-config, libssl-dev, 31GB RAM
curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal   # rustc 1.100.0
curl -fsSL https://ix.dev/blaze | sh                    # installs blaze 0.20261027.0 (v1)
curl -fsSL https://ix.dev/blaze | sh -s -- --channel canary   # installs 0.20261105.4 (v2)
export BLAZE_SANDBOX=off                                # no userns/Landlock (WSL1, old kernels, containers)

cd web/api            # with entities/, ../shared/article-relationships/, data/mysql/*.sql staged
cargo build                                             # 2m16s cold
time blaze build                                        # FAIL ~16min, ~8GB RSS, __RUST_STD_INTERNAL_VAL
time blaze check                                        # 4m01s warm-deps; 1.68s after one-fn edit
cd ../data && time blaze build                          # FAIL 4m39s aws-lc-sys build script
# v2 on this host: `blaze build` -> io_uring_setup ENOSYS (WSL1/no-virt);
#   needs Linux >=5.1 w/ io_uring + namespaces or BLAZE_SANDBOX=off, glibc>=2.34
```

Versions used: master `0e6f392a2`; blaze `0.20261027.0` (`49ca152`, v1) and
`0.20261105.4` (`e930296`, v2 canary, sha256 `a8b8f3b3…`); upstream docs
`c54fc993e`; rustc 1.100.0; cargo-make 0.37.24 is what CI installs but all
measured commands were bare `cargo`/`blaze`.
