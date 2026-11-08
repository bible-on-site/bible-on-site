using System.Buffers.Binary;
using System.IO.Compression;
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
    private static byte[] Elf(bool symbols = true, byte id = 1)
    {
        var bytes = new byte[512];
        "\u007fELF\u0002\u0001\u0001"u8.CopyTo(bytes);
        U16(bytes, 16, 3); U16(bytes, 18, 183); U32(bytes, 20, 1);
        U64(bytes, 40, 64); U16(bytes, 52, 64); U16(bytes, 58, 64); U16(bytes, 60, 3);
        U32(bytes, 128 + 4, 7); U64(bytes, 128 + 24, 256); U64(bytes, 128 + 32, 20);
        U32(bytes, 256, 4); U32(bytes, 260, 1); U32(bytes, 264, 3);
        "GNU\0"u8.CopyTo(bytes.AsSpan(268)); bytes[272] = id;
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
}
