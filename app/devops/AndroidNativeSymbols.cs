using System.Buffers.Binary;
using System.IO.Compression;

/// <summary>Packages the Android SDK's separate debug ELF, bound to the shipped library.</summary>
internal static class AndroidNativeSymbols
{
    public static void Create(string sharedLibraries, string bundlePath, string outputPath)
    {
        using var bundle = ZipFile.OpenRead(bundlePath);
        var symbols = new List<(string Name, byte[] Data)>();
        foreach (var file in Directory.EnumerateFiles(sharedLibraries, "*.dbg.so", SearchOption.AllDirectories)
                     .Order(StringComparer.Ordinal))
        {
            var relative = Path.GetRelativePath(sharedLibraries, file).Replace('\\', '/');
            var parts = relative.Split('/');
            if (parts.Length != 2 || parts[0] != "arm64-v8a" || !parts[1].StartsWith("lib", StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Unexpected Android debug library: {relative}");
            }

            // .NET emits libxamarin-app.dbg.so beside stripped libxamarin-app.so.
            // Play needs the shipped library's name, not the .dbg filename.
            var name = relative[..^".dbg.so".Length] + ".so";
            var debugBytes = File.ReadAllBytes(file);
            VerifyBundled(bundle, name, debugBytes);
            symbols.Add((name, debugBytes));
        }

        if (symbols.Count == 0)
        {
            throw new InvalidDataException("No separate Android native debug symbols were produced");
        }

        // Validate everything before creating an output; never include the
        // assembly-store blob, its manifest, or a stripped library as symbols.
        using var output = new FileStream(outputPath, FileMode.CreateNew, FileAccess.Write);
        using var zip = new ZipArchive(output, ZipArchiveMode.Create);
        foreach (var symbol in symbols)
        {
            using var entry = zip.CreateEntry(symbol.Name).Open();
            entry.Write(symbol.Data);
        }
    }

    /// <summary>
    /// Re-validates a packaged symbols archive against the AAB it deploys beside.
    /// Play rejects a malformed archive only after the bundle is already
    /// uploaded (#2970), so packaging and deployment run this over the stored
    /// zip before any store write. Returns the bundled arm64 libraries the
    /// archive does not cover; .NET/Android runtime libraries ship stripped-only
    /// and Play accepts partial coverage.
    /// </summary>
    public static IReadOnlyList<string> Validate(string symbolsPath, string bundlePath)
    {
        var symbols = new List<(string Name, byte[] Data)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        using (var zip = ZipFile.OpenRead(symbolsPath))
        {
            foreach (var entry in zip.Entries.OrderBy(e => e.FullName, StringComparer.Ordinal))
            {
                var parts = entry.FullName.Split('/');
                if (parts.Length != 2 || parts[0] != "arm64-v8a" ||
                    !parts[1].StartsWith("lib", StringComparison.Ordinal) ||
                    !parts[1].EndsWith(".so", StringComparison.Ordinal))
                {
                    throw new InvalidDataException($"Unexpected native symbols entry: {entry.FullName}");
                }
                if (entry.Length == 0 || !seen.Add(entry.FullName))
                {
                    throw new InvalidDataException($"Empty or duplicate native symbols entry: {entry.FullName}");
                }
                using var stream = entry.Open();
                using var data = new MemoryStream();
                stream.CopyTo(data);
                symbols.Add((entry.FullName, data.ToArray()));
            }
        }
        if (symbols.Count == 0)
        {
            throw new InvalidDataException("Native symbols archive is empty");
        }

        var bundled = new List<string>();
        using (var bundle = ZipFile.OpenRead(bundlePath))
        {
            foreach (var symbol in symbols)
            {
                VerifyBundled(bundle, symbol.Name, symbol.Data);
            }
            bundled.AddRange(bundle.Entries
                .Where(e => e.FullName.StartsWith("base/lib/arm64-v8a/lib", StringComparison.Ordinal) &&
                            e.FullName.EndsWith(".so", StringComparison.Ordinal))
                .Select(e => e.FullName["base/lib/".Length..]));
        }
        var covered = symbols.Select(s => s.Name).ToHashSet(StringComparer.Ordinal);
        return bundled.Where(name => !covered.Contains(name)).Order(StringComparer.Ordinal).ToList();
    }

    // A symbols entry must name exactly one bundled arm64 library and carry the
    // same GNU build ID — proof both were cut from the same native build.
    private static void VerifyBundled(ZipArchive bundle, string name, byte[] symbolBytes)
    {
        var shipped = bundle.Entries.Where(e => e.FullName == "base/lib/" + name).ToArray();
        if (shipped.Length != 1)
        {
            throw new InvalidDataException($"Expected exactly one bundled library for {name}");
        }
        using var shippedStream = shipped[0].Open();
        using var shippedBytes = new MemoryStream();
        shippedStream.CopyTo(shippedBytes);
        if (ReadBuildId(symbolBytes, requireSymbols: true) != ReadBuildId(shippedBytes.ToArray(), requireSymbols: false))
        {
            throw new InvalidDataException($"Native symbols do not match the bundled library: {name}");
        }
    }

    private static ReadOnlySpan<byte> Slice(byte[] bytes, ulong offset, ulong length)
    {
        if (offset > (ulong)bytes.Length || length > (ulong)bytes.Length - offset)
        {
            throw new InvalidDataException("Truncated native ELF data");
        }
        return bytes.AsSpan((int)offset, (int)length);
    }

    internal static string ReadBuildId(byte[] bytes, bool requireSymbols)
    {
        var header = Slice(bytes, 0, 64);
        // The release target is android-arm64: ELF64, little-endian, AArch64.
        if (!header[..7].SequenceEqual("\u007fELF\u0002\u0001\u0001"u8) ||
            BinaryPrimitives.ReadUInt16LittleEndian(header[16..]) != 3 ||
            BinaryPrimitives.ReadUInt16LittleEndian(header[18..]) != 183 ||
            BinaryPrimitives.ReadUInt32LittleEndian(header[20..]) != 1)
        {
            throw new InvalidDataException("Expected an Android arm64 ELF library");
        }
        var tableOffset = BinaryPrimitives.ReadUInt64LittleEndian(header[40..]);
        var entrySize = BinaryPrimitives.ReadUInt16LittleEndian(header[58..]);
        var count = BinaryPrimitives.ReadUInt16LittleEndian(header[60..]);
        if (entrySize != 64 || count == 0 || tableOffset < 64)
        {
            throw new InvalidDataException("Invalid ELF section table");
        }
        var table = Slice(bytes, tableOffset, (ulong)count * 64);
        var hasSymbols = false;
        string? buildId = null;
        for (var i = 0; i < count; i++)
        {
            var section = table.Slice(i * 64, 64);
            var type = BinaryPrimitives.ReadUInt32LittleEndian(section[4..]);
            var offset = BinaryPrimitives.ReadUInt64LittleEndian(section[24..]);
            var size = BinaryPrimitives.ReadUInt64LittleEndian(section[32..]);
            if (type == 2) // SHT_SYMTAB, not the stripped dynamic export table.
            {
                var data = Slice(bytes, offset, size);
                hasSymbols |= BinaryPrimitives.ReadUInt64LittleEndian(section[56..]) == 24 && data.Length > 24;
            }
            if (type != 7) // SHT_NOTE
            {
                continue;
            }
            var notes = Slice(bytes, offset, size);
            while (!notes.IsEmpty)
            {
                if (notes.Length < 12)
                {
                    throw new InvalidDataException("Truncated ELF note");
                }
                var nameLength = BinaryPrimitives.ReadUInt32LittleEndian(notes);
                var valueLength = BinaryPrimitives.ReadUInt32LittleEndian(notes[4..]);
                var noteType = BinaryPrimitives.ReadUInt32LittleEndian(notes[8..]);
                var paddedName = ((ulong)nameLength + 3) & ~3UL;
                var paddedValue = ((ulong)valueLength + 3) & ~3UL;
                if (12 + paddedName + paddedValue > (ulong)notes.Length)
                {
                    throw new InvalidDataException("Truncated ELF note value");
                }
                if (noteType == 3 && notes.Slice(12, (int)nameLength).SequenceEqual("GNU\0"u8))
                {
                    if (valueLength == 0 || buildId is not null)
                    {
                        throw new InvalidDataException("Missing or ambiguous ELF build ID");
                    }
                    buildId = Convert.ToHexString(notes.Slice(12 + (int)paddedName, (int)valueLength));
                }
                notes = notes[(int)(12 + paddedName + paddedValue)..];
            }
        }
        if (buildId is null || (requireSymbols && !hasSymbols))
        {
            throw new InvalidDataException("Native library lacks its build ID or debug symbol table");
        }
        return buildId;
    }
}
