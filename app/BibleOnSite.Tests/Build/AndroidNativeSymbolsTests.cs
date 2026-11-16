using System.Buffers.Binary;
using System.IO.Compression;
using System.Net;
using Xunit;

public class AndroidNativeSymbolsTests : IDisposable
{
    private readonly string root = Path.Join(Path.GetTempPath(), "android-symbols-" + Guid.NewGuid());
    private string Libraries => Path.Join(root, "libraries");
    private string Bundle => Path.Join(root, "app.aab");
    private string Output => Path.Join(root, "symbols.zip");

    public AndroidNativeSymbolsTests() => Directory.CreateDirectory(Libraries);
    public void Dispose() => Directory.Delete(root, recursive: true);

    private void Library(string name, byte[] bytes)
    {
        var path = Path.Join(Libraries, name.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, bytes);
    }

    private void Aab(params (string Name, byte[] Bytes)[] libraries)
    {
        using var zip = ZipFile.Open(Bundle, ZipArchiveMode.Create);
        foreach (var (name, bytes) in libraries)
        {
            using var stream = zip.CreateEntry("base/lib/" + name).Open();
            stream.Write(bytes);
        }
    }

    private void Symbols(params (string Name, byte[] Bytes)[] entries)
    {
        // ZipArchiveMode.Create maps to FileMode.CreateNew — drop a prior case.
        File.Delete(Output);
        using var zip = ZipFile.Open(Output, ZipArchiveMode.Create);
        foreach (var (name, bytes) in entries)
        {
            using var stream = zip.CreateEntry(name).Open();
            stream.Write(bytes);
        }
    }

    private static void U16(byte[] bytes, int at, ushort value) => BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(at), value);
    private static void U32(byte[] bytes, int at, uint value) => BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(at), value);
    private static void U64(byte[] bytes, int at, ulong value) => BinaryPrimitives.WriteUInt64LittleEndian(bytes.AsSpan(at), value);

    // AArch64 ELF64 with a GNU build ID and an optional static symbol table.
    private static byte[] Elf(bool symbols = true, byte id = 1, byte[]? buildId = null)
    {
        var bytes = new byte[512];
        "\u007fELF\u0002\u0001\u0001"u8.CopyTo(bytes);
        U16(bytes, 16, 3); U16(bytes, 18, 183); U32(bytes, 20, 1);
        U64(bytes, 40, 64); U16(bytes, 52, 64); U16(bytes, 58, 64); U16(bytes, 60, 3);
        buildId ??= [id];
        U32(bytes, 128 + 4, 7); U64(bytes, 128 + 24, 256); U64(bytes, 128 + 32, (ulong)(16 + ((buildId.Length + 3) & ~3)));
        U32(bytes, 256, 4); U32(bytes, 260, (uint)buildId.Length); U32(bytes, 264, 3);
        "GNU\0"u8.CopyTo(bytes.AsSpan(268)); buildId.CopyTo(bytes.AsSpan(272));
        if (symbols)
        {
            U32(bytes, 192 + 4, 2); U64(bytes, 192 + 24, 384);
            U64(bytes, 192 + 32, 48); U64(bytes, 192 + 56, 24);
        }
        return bytes;
    }

    [Fact]
    public void Includes_only_matching_debug_ELF_under_the_shipped_library_name()
    {
        var debug = Elf();
        Library("arm64-v8a/libxamarin-app.dbg.so", debug);
        Library("arm64-v8a/libxamarin-app.so", Elf(symbols: false));
        Library("arm64-v8a/assembly-store.so", "not an ELF"u8.ToArray());
        Library("arm64-v8a/assembly-store.so.manifest", "manifest"u8.ToArray());
        Aab(("arm64-v8a/libxamarin-app.so", Elf(symbols: false)));

        AndroidNativeSymbols.Create(Libraries, Bundle, Output);

        using var zip = ZipFile.OpenRead(Output);
        var entry = Assert.Single(zip.Entries);
        Assert.Equal("arm64-v8a/libxamarin-app.so", entry.FullName);
        using var data = new MemoryStream();
        using var stream = entry.Open();
        stream.CopyTo(data);
        Assert.Equal(debug, data.ToArray());
    }

    [Fact]
    public void Packages_each_matching_library_in_stable_order()
    {
        Library("arm64-v8a/libz.dbg.so", Elf(id: 2));
        Library("arm64-v8a/liba.dbg.so", Elf(id: 3));
        Aab(("arm64-v8a/libz.so", Elf(symbols: false, id: 2)), ("arm64-v8a/liba.so", Elf(symbols: false, id: 3)));
        AndroidNativeSymbols.Create(Libraries, Bundle, Output);
        using var zip = ZipFile.OpenRead(Output);
        Assert.Equal(["arm64-v8a/liba.so", "arm64-v8a/libz.so"], zip.Entries.Select(e => e.FullName));
    }

    [Theory]
    [InlineData("nested/arm64-v8a/libx.dbg.so")]
    [InlineData("x86_64/libx.dbg.so")]
    [InlineData("arm64-v8a/data.dbg.so")]
    public void Rejects_an_unexpected_debug_library_layout(string path)
    {
        Library(path, Elf()); Aab();
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output));
        Assert.False(File.Exists(Output));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public void Requires_exactly_one_corresponding_bundled_library(int count)
    {
        Library("arm64-v8a/libx.dbg.so", Elf());
        Aab(Enumerable.Range(0, count).Select(_ => ("arm64-v8a/libx.so", Elf(symbols: false))).ToArray());
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output));
        Assert.False(File.Exists(Output));
    }

    [Fact]
    public void Rejects_symbols_from_another_build_before_writing_the_archive()
    {
        Library("arm64-v8a/libx.dbg.so", Elf(id: 1));
        Aab(("arm64-v8a/libx.so", Elf(symbols: false, id: 2)));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output));
        Assert.False(File.Exists(Output));
    }

    [Fact]
    public void Does_not_fall_back_to_stripped_libraries_or_an_empty_symbols_archive()
    {
        Library("arm64-v8a/libx.so", Elf(symbols: false)); Aab();
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output));
        Assert.False(File.Exists(Output));
    }

    [Fact]
    public void Rejects_a_stripped_file_mislabeled_as_debug_symbols()
    {
        Library("arm64-v8a/libx.dbg.so", Elf(symbols: false));
        Aab(("arm64-v8a/libx.so", Elf(symbols: false)));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output));
    }

    [Fact]
    public void Does_not_overwrite_an_existing_archive()
    {
        Library("arm64-v8a/libx.dbg.so", Elf()); Aab(("arm64-v8a/libx.so", Elf(symbols: false)));
        File.WriteAllText(Output, "keep");
        Assert.Throws<IOException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output));
        Assert.Equal("keep", File.ReadAllText(Output));
    }

    [Fact]
    public void Rejects_truncated_headers_and_missing_symbols()
    {
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.ReadBuildId(new byte[20], true));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.ReadBuildId(Elf(symbols: false), true));
        Assert.Equal("01", AndroidNativeSymbols.ReadBuildId(Elf(symbols: false), false));
    }

    [Fact]
    public void Rejects_invalid_native_headers_sections_and_notes()
    {
        Action<byte[]>[] invalid = [
            b => b[0] = 0,
            b => b[4] = 1,
            b => b[5] = 2,
            b => b[6] = 0,
            b => U16(b, 16, 1),
            b => U16(b, 18, 62),
            b => U32(b, 20, 0),
            b => U16(b, 58, 32),
            b => U16(b, 60, 0),
            b => U16(b, 60, ushort.MaxValue),
            b => U64(b, 40, 0),
            b => U64(b, 40, ulong.MaxValue),
            b => U64(b, 192 + 24, 600),
            b => U64(b, 192 + 32, 200),
            b => U64(b, 192 + 32, 24),
            b => U64(b, 192 + 56, 0),
            b => U64(b, 128 + 24, 600),
            b => U64(b, 128 + 32, 8),
            b => U64(b, 128 + 32, 16),
            b => U32(b, 256, uint.MaxValue),
            b => U32(b, 260, uint.MaxValue),
            b => U32(b, 260, 0),
            b => U32(b, 264, 1),
            b => b[268] = 0,
            b => U32(b, 128 + 4, 0)
        ];
        foreach (var corrupt in invalid)
        {
            var bytes = Elf(); corrupt(bytes);
            Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.ReadBuildId(bytes, true));
        }
    }

    [Fact]
    public void Skips_other_notes_but_rejects_ambiguous_GNU_build_IDs()
    {
        var bytes = Elf();
        bytes.AsSpan(256, 20).CopyTo(bytes.AsSpan(276));
        U64(bytes, 128 + 32, 40);
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.ReadBuildId(bytes, true));
        U32(bytes, 264, 1);
        Assert.Equal("01", AndroidNativeSymbols.ReadBuildId(bytes, true));
    }

    [Fact]
    public void Validate_accepts_the_archive_Create_produces()
    {
        Library("arm64-v8a/libxamarin-app.dbg.so", Elf());
        Library("arm64-v8a/libxamarin-app.so", Elf(symbols: false));
        Library("arm64-v8a/assembly-store.so", "not an ELF"u8.ToArray());
        Library("arm64-v8a/assembly-store.so.manifest", "manifest"u8.ToArray());
        Aab(("arm64-v8a/libxamarin-app.so", Elf(symbols: false)),
            ("arm64-v8a/libstripped-dep.so", Elf(symbols: false, id: 9)));
        AndroidNativeSymbols.Create(Libraries, Bundle, Output);

        var uncovered = AndroidNativeSymbols.Validate(Output, Bundle);

        // The runtime dependency ships stripped-only: partial coverage is
        // reported, not silently treated as complete.
        Assert.Equal(["arm64-v8a/libstripped-dep.so"], uncovered);
    }

    [Fact]
    public void Validate_rejects_the_legacy_whole_folder_archive()
    {
        // The 5.0.228 release asset Play rejected with HTTP 400 (#2970): the
        // intermediate directory zipped verbatim — the non-ELF assembly-store
        // blob, its manifest, the stripped library and the debug ELF still
        // under its .dbg.so filename.
        Aab(("arm64-v8a/libxamarin-app.so", Elf(symbols: false)));
        Symbols(
            ("arm64-v8a/assembly-store.so", "not an ELF"u8.ToArray()),
            ("arm64-v8a/assembly-store.so.manifest", "manifest"u8.ToArray()),
            ("arm64-v8a/libxamarin-app.dbg.so", Elf()),
            ("arm64-v8a/libxamarin-app.so", Elf(symbols: false)));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Validate_rejects_an_empty_archive()
    {
        Aab(("arm64-v8a/libx.so", Elf(symbols: false)));
        Symbols();
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Theory]
    [InlineData("libx.so")]
    [InlineData("x86_64/libx.so")]
    [InlineData("arm64-v8a/nested/libx.so")]
    [InlineData("arm64-v8a/libx.txt")]
    [InlineData("arm64-v8a/store.so")]
    [InlineData("arm64-v8a/")]
    public void Validate_rejects_entries_outside_the_abi_library_layout(string entryName)
    {
        Aab(("arm64-v8a/libx.so", Elf(symbols: false)));
        Symbols((entryName, Elf()));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Validate_rejects_a_symbols_entry_named_by_debug_filename_not_shipped_library()
    {
        Aab(("arm64-v8a/libx.so", Elf(symbols: false)));
        Symbols(("arm64-v8a/libx.dbg.so", Elf()));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Validate_rejects_a_symbols_entry_with_no_bundled_library()
    {
        Aab(("arm64-v8a/libx.so", Elf(symbols: false)));
        Symbols(("arm64-v8a/libghost.so", Elf()));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Validate_rejects_stripped_and_non_elf_entries()
    {
        Aab(("arm64-v8a/libx.so", Elf(symbols: false)));
        Symbols(("arm64-v8a/libx.so", "not an ELF"u8.ToArray()));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
        Symbols(("arm64-v8a/libx.so", Elf(symbols: false)));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Validate_rejects_symbols_from_another_build()
    {
        Aab(("arm64-v8a/libx.so", Elf(symbols: false, id: 2)));
        Symbols(("arm64-v8a/libx.so", Elf(id: 1)));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Validate_rejects_an_empty_entry()
    {
        Aab(("arm64-v8a/libx.so", Elf(symbols: false)));
        using (var zip = ZipFile.Open(Output, ZipArchiveMode.Create))
        {
            zip.CreateEntry("arm64-v8a/libx.so");
        }
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Validate_rejects_duplicate_entry_names()
    {
        Aab(("arm64-v8a/libx.so", Elf(symbols: false)));
        using (var zip = ZipFile.Open(Output, ZipArchiveMode.Create))
        {
            foreach (var _ in Enumerable.Range(0, 2))
            {
                using var stream = zip.CreateEntry("arm64-v8a/libx.so").Open();
                stream.Write(Elf());
            }
        }
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Validate_rejects_a_non_zip_archive()
    {
        File.WriteAllText(Output, "not a zip");
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Validate_reports_every_bundled_library_without_symbol_coverage()
    {
        Aab(("arm64-v8a/liba.so", Elf(symbols: false, id: 1)),
            ("arm64-v8a/libb.so", Elf(symbols: false, id: 2)),
            ("arm64-v8a/libc.so", Elf(symbols: false, id: 3)));
        Symbols(("arm64-v8a/liba.so", Elf(id: 1)));
        Assert.Equal(["arm64-v8a/libb.so", "arm64-v8a/libc.so"], AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Fact]
    public void Includes_public_and_embedded_symbols_but_keeps_unavailable_files_and_data_explicit()
    {
        var coreId = Enumerable.Repeat((byte)2, 20).ToArray();
        var vendorId = Enumerable.Repeat((byte)3, 20).ToArray();
        var missingId = Enumerable.Repeat((byte)4, 20).ToArray();
        Library("arm64-v8a/libxamarin-app.dbg.so", Elf());
        Aab(("arm64-v8a/libxamarin-app.so", Elf(symbols: false)),
            ("arm64-v8a/libcoreclr.so", Elf(symbols: false, buildId: coreId)),
            ("arm64-v8a/libHarfBuzzSharp.so", Elf(symbols: false, buildId: vendorId)),
            ("arm64-v8a/libmonodroid.so", Elf(id: 5)),
            ("arm64-v8a/libe_sqlite3.so", Elf(symbols: false, buildId: missingId)),
            ("arm64-v8a/libassembly-store.so", Elf(id: 6)));
        var requests = new List<string>();
        AndroidNativeSymbols.Create(Libraries, Bundle, Output, id =>
        {
            requests.Add(id);
            return id == Convert.ToHexString(missingId) ? null : Elf(buildId: Convert.FromHexString(id));
        });

        using var zip = ZipFile.OpenRead(Output);
        Assert.Equal(["arm64-v8a/libHarfBuzzSharp.so", "arm64-v8a/libcoreclr.so", "arm64-v8a/libmonodroid.so", "arm64-v8a/libxamarin-app.so"],
            zip.Entries.Select(entry => entry.FullName));
        Assert.Equal(3, requests.Count);
        Assert.Equal(["arm64-v8a/libassembly-store.so", "arm64-v8a/libe_sqlite3.so"], AndroidNativeSymbols.Validate(Output, Bundle));
    }

    [Theory]
    [InlineData("mismatched")]
    [InlineData("stripped")]
    [InlineData("not-elf")]
    public void Rejects_invalid_public_symbols_before_creating_any_archive(string failure)
    {
        var id = Enumerable.Repeat((byte)2, 20).ToArray();
        Library("arm64-v8a/libxamarin-app.dbg.so", Elf());
        Aab(("arm64-v8a/libxamarin-app.so", Elf(symbols: false)),
            ("arm64-v8a/libcoreclr.so", Elf(symbols: false, buildId: id)));
        var invalid = failure switch
        {
            "mismatched" => Elf(),
            "stripped" => Elf(symbols: false, buildId: id),
            _ => "not ELF"u8.ToArray()
        };
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output, _ => invalid));
        Assert.False(File.Exists(Output));
    }

    [Fact]
    public void Public_runtime_symbols_cannot_hide_missing_app_owned_sidecars()
    {
        var id = Enumerable.Repeat((byte)2, 20).ToArray();
        Aab(("arm64-v8a/libcoreclr.so", Elf(symbols: false, buildId: id)));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output,
            _ => throw new InvalidOperationException("Must reject missing app symbols before network access")));
        Assert.False(File.Exists(Output));
    }

    [Fact]
    public void Rejects_nested_bundled_library_names_before_creating_the_archive()
    {
        Library("arm64-v8a/libxamarin-app.dbg.so", Elf());
        Aab(("arm64-v8a/libxamarin-app.so", Elf(symbols: false)),
            ("arm64-v8a/libnested/libx.so", Elf()));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output));
        Assert.False(File.Exists(Output));
    }

    [Theory]
    [InlineData("libassembly-store.so")]
    [InlineData("libassemblies.arm64-v8a.blob.so")]
    public void Rejects_assembly_store_data_even_when_it_has_an_ELF_symbol_table(string library)
    {
        Aab(("arm64-v8a/" + library, Elf()));
        Symbols(("arm64-v8a/" + library, Elf()));
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Validate(Output, Bundle));
        File.Delete(Output);
        Library("arm64-v8a/" + library[..^3] + ".dbg.so", Elf());
        Assert.Throws<InvalidDataException>(() => AndroidNativeSymbols.Create(Libraries, Bundle, Output));
        Assert.False(File.Exists(Output));
    }

    [Fact]
    public async Task Public_symbol_lookup_uses_the_official_build_ID_key_and_validates_the_response()
    {
        var id = Convert.FromHexString("ABCDEF0123456789ABCDEF0123456789ABCDEF01");
        var expected = Elf(buildId: id);
        using var client = new HttpClient(new SymbolHandler(request =>
        {
            Assert.Equal("https://msdl.microsoft.com/download/symbols/_.debug/elf-buildid-sym-abcdef0123456789abcdef0123456789abcdef01/_.debug",
                request.RequestUri!.AbsoluteUri);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(expected) };
        }));
        Assert.Equal(expected, await AndroidNativeSymbols.DownloadPublicSymbols(Convert.ToHexString(id), client));
    }

    [Fact]
    public async Task Reports_missing_public_files_without_treating_a_service_outage_as_unavailability()
    {
        foreach (var status in new[] { HttpStatusCode.NotFound, HttpStatusCode.InternalServerError, HttpStatusCode.Forbidden })
        {
            var calls = 0;
            using var client = new HttpClient(new SymbolHandler(_ =>
            {
                calls++;
                return new HttpResponseMessage(status);
            }));
            var download = AndroidNativeSymbols.DownloadPublicSymbols("0123456789ABCDEF", client);
            if (status == HttpStatusCode.NotFound)
            {
                Assert.Null(await download);
            }
            else
            {
                await Assert.ThrowsAsync<HttpRequestException>(() => download);
            }
            Assert.Equal(1, calls);
        }
    }

    [Theory]
    [InlineData("mismatched")]
    [InlineData("stripped")]
    [InlineData("invalid")]
    [InlineData("too-large")]
    [InlineData("unbounded-stream")]
    public async Task Public_download_rejects_invalid_or_unbounded_symbol_content(string failure)
    {
        var id = Convert.FromHexString("0123456789ABCDEF");
        using var client = new HttpClient(new SymbolHandler(_ =>
        {
            HttpContent content = failure switch
            {
                "mismatched" => new ByteArrayContent(Elf()),
                "stripped" => new ByteArrayContent(Elf(symbols: false, buildId: id)),
                "unbounded-stream" => new StreamContent(new ZeroStream(AndroidNativeSymbols.MaximumSymbolBytes + 1L)),
                _ => new ByteArrayContent([])
            };
            if (failure == "too-large")
            {
                content.Headers.ContentLength = AndroidNativeSymbols.MaximumSymbolBytes + 1L;
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        }));
        await Assert.ThrowsAsync<InvalidDataException>(() => AndroidNativeSymbols.DownloadPublicSymbols(Convert.ToHexString(id), client));
    }

    [Theory]
    [InlineData("")]
    [InlineData("../arbitrary-host")]
    [InlineData("ABC")]
    [InlineData("0123456789ABCDEG")]
    public async Task Invalid_public_keys_never_make_a_request(string id)
    {
        using var client = new HttpClient(new SymbolHandler(_ => throw new InvalidOperationException("No request expected")));
        await Assert.ThrowsAsync<ArgumentException>(() => AndroidNativeSymbols.DownloadPublicSymbols(id, client));
    }

    private sealed class SymbolHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(respond(request));
        }
    }

    private sealed class ZeroStream(long length) : Stream
    {
        private long remaining = length;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));
        public override int Read(Span<byte> buffer)
        {
            var count = (int)Math.Min(buffer.Length, remaining);
            buffer[..count].Clear();
            remaining -= count;
            return count;
        }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return ValueTask.FromResult(Read(buffer.Span));
        }
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin)
        {
            _ = offset;
            _ = origin;
            throw new NotSupportedException();
        }
        public override void SetLength(long value)
        {
            _ = value;
            throw new NotSupportedException();
        }
        public override void Write(byte[] buffer, int offset, int count)
        {
            _ = buffer;
            _ = offset;
            _ = count;
            throw new NotSupportedException();
        }
    }
}
