# Android native debug symbols

The Play symbols archive (`*-native-symbols.zip` beside the AAB) must carry a
symbol-bearing ELF for every bundled `arm64-v8a` library, matched by its exact
GNU build ID. `AndroidNativeSymbols.Create` (app/devops) resolves each library
from these sources, in order:

1. **App-owned sidecars** - `app_shared_libraries/**/arm64-v8a/*.dbg.so`
   produced by the .NET Android build. Mandatory; missing sidecars fail before
   any network access.
2. **Embedded symbol tables** - a bundled `.so` that still carries `.symtab`
   is used as-is.
3. **Microsoft SSQP store** - `msdl.microsoft.com/download/symbols`, keyed by
   `elf-buildid-sym-<id>` (the dotnet-symbol/PerfView convention). Covers .NET
   runtime libraries.
4. **Supplier store** - `ANDROID_VENDOR_SYMBOLS_BASE_URL` plus the lowercase
   build ID (`{base}/{build-id}`). Covers vendor libraries whose suppliers do
   not publish to Microsoft, such as SourceGear `libe_sqlite3.so` (#3440). The
   variable is a GitHub Actions *variable* (not a secret); unset/empty disables
   the source entirely.

Every downloaded or cached artifact passes the same gate before it may enter
the archive or the on-disk cache (`app/.cache/android-native-symbols`, keyed by
build ID, saved/restored by `actions/cache`): ELF64 little-endian AArch64,
exact GNU build-ID match, real `.symtab`, size cap. `Validate` re-checks the
stored zip against the AAB and reports uncovered libraries explicitly -
assembly-store data containers are excluded by design, never silently
"complete" coverage.

## libe_sqlite3.so provenance (#3440)

`SourceGear.sqlite3 3.53.3` ships
`runtimes/android-arm64/native/libe_sqlite3.so` stripped:

- sha256 `f6672612ceb79d6f5681773ba8343776bc34fdc963f4d5882bed774c890aaabd`
- GNU build ID `0457c6b0845ea71672e4852f38a39bd92e06ee8b`
- size 1,771,632 bytes, Android NDK r27c (clang 18.0.3), `-O1`, 16 KiB pages

No debug ELF, `.snupkg`, or symbol sidecar exists in the package, NuGet's
symbol endpoints, or Microsoft SSQP. The recorded source repository
(`sourcegear/sqlite-builds@21770fb`) is private; the public upstream is
`ericsink/cb`, where `ericsink/SQLitePCL.raw#312` tracks official symbol publication.

Because no authentic artifact is obtainable, the pipeline serves a
**verified-identical rebuild**: the unstripped ELF produced by rebuilding the
exact SQLite 3.53.3 amalgamation (`d4c0e51e...782c62`, same source ID embedded
in the shipped binary) with NDK r27c and the shipped binary's compile options
(`-O1`, `SQLITE_ENABLE_COLUMN_METADATA|FTS3|FTS3_PARENTHESIS|FTS4|FTS5|
GEOPOLY|MATH_FUNCTIONS|PREUPDATE_HOOK|RTREE|SESSION|SNAPSHOT`,
`SQLITE_DEFAULT_FOREIGN_KEYS=1`, `SQLITE_DQS=0`,
`SQLITE_LIKE_DOESNT_MATCH_BLOBS`, `SQLITE_MAX_WORKER_THREADS=8`,
`SQLITE_SYSTEM_MALLOC`, `SQLITE_DIRECT_OVERFLOW_READ`, `SQLITE_OS_UNIX`,
`stubs.c` for the SQLCipher stubs, `-llog`,
`-Wl,-z,max-page-size=16384`). The rebuild reproduces the shipped library
byte-for-byte in every section the stripped binary contains. The original
build-ID digest is unreproducible because SHA1 build IDs hash the unstripped
link output, which embeds the supplier's build-directory and NDK paths in
DWARF; the artifact therefore carries the shipped `.comment` and
`.note.gnu.build-id` contents verbatim so the pair binds by construction.

Verification: `llvm-strip --strip-unneeded` on the artifact yields sha256
`f6672612...aabd` - byte-for-byte the shipped library - and the pipeline's own
`ReadBuildId`/`VerifyBundled` validation passes against the real AAB payload.
It is hosted as a release asset named by build ID under tag
`native-symbols-v1`, fetched through `ANDROID_VENDOR_SYMBOLS_BASE_URL` and
cached like any other cold download. If SourceGear later publishes an official
artifact it can replace this file under the same name, but a populated cache
keeps serving the earlier entry - evict it as described below.

## Adding or replacing a supplier artifact

```bash
# 1. Verify the candidate itself: ELF64/AArch64 ET_DYN, a real SHT_SYMTAB, and
#    a GNU build-id note identical to the bundled library's. The pipeline
#    re-runs this gate inside PackageAndroidSymbols; this step validates the
#    file being uploaded.
readelf -h <candidate>                     # Type: DYN, Machine: AArch64
readelf -S <candidate> | grep '\.symtab'
readelf -n <candidate> | grep -A2 'Build ID'

# 2. Host it as {base}/{lowercase build id} - currently release assets under
#    https://github.com/bible-on-site/bible-on-site/releases/tag/native-symbols-v1
gh release upload native-symbols-v1 <debug-elf-as-build-id-name> --clobber

# 3. Replacing an asset under the same name does not evict the populated
#    build-ID cache: the earlier valid entry is returned without fetching.
#    Remove it locally and in CI, then rebuild:
rm app/.cache/android-native-symbols/<build id>
gh cache list --key android-native-symbols-v1-   # then gh cache delete <id>

# 4. Local/one-off use can skip the store entirely: drop the validated file at
#    app/.cache/android-native-symbols/<lowercase build id> and rebuild.
```

Dependency upgrades change the build ID: a new artifact must be obtained or
rebuilt and re-verified before the new package can be symbolized.
