using System.Buffers.Binary;
using System.IO.Compression;
using System.Net;

/// <summary>Packages validated native symbols bound to the exact shipped ELF build IDs.</summary>
internal static class AndroidNativeSymbols
{
    private static readonly HttpClient SymbolClient = new();
    internal const int MaximumSymbolBytes = 128 * 1024 * 1024;
    // #3444: only cold (cache-miss) public downloads may take this long —
    // a completed transfer returns immediately. Warm cache hits never
    // reach the network, and every other deadline stays unchanged.
    internal static readonly TimeSpan ColdDownloadDeadline = TimeSpan.FromSeconds(90);

    // #3440: supplier-published debug ELFs are fetched from this flat base URL
    // as {base}/{lowercase GNU build ID} when the Microsoft store has no entry.
    internal const string VendorSymbolsBaseUrlVariable = "ANDROID_VENDOR_SYMBOLS_BASE_URL";

    private static string? VendorSymbolsBaseUrl =>
        Environment.GetEnvironmentVariable(VendorSymbolsBaseUrlVariable) is { Length: > 0 } value ? value : null;

    public static void Create(string sharedLibraries, string bundlePath, string outputPath,
        Func<string, byte[]?>? findPublicSymbols = null, string? symbolCacheDir = null,
        Func<string, byte[]?>? findVendorSymbols = null, bool includeExternalSymbols = true)
    {
        if (File.Exists(outputPath))
        {
            throw new IOException("Native symbols archive already exists");
        }
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
            if (IsDataContainer(name))
            {
                throw new InvalidDataException("Assembly-store data is not native debug symbols");
            }
            var debugBytes = File.ReadAllBytes(file);
            VerifyBundled(bundle, name, debugBytes);
            symbols.Add((name, debugBytes));
        }

        if (symbols.Count == 0)
        {
            throw new InvalidDataException("No separate Android native debug symbols were produced");
        }

        // Keep the app-owned sidecar requirement above. Runtime/vendor libraries
        // may carry their own symbol table or publish matching debug ELFs through
        // Microsoft's public, content-addressed SSQP symbol store, or through the
        // supplier store ANDROID_VENDOR_SYMBOLS_BASE_URL points at (#3440).
        AddAvailableSymbols(bundle, symbols, findPublicSymbols, symbolCacheDir, findVendorSymbols, includeExternalSymbols);

        // Validate everything before creating an output; never include the
        // assembly-store blob, its manifest, or a stripped library as symbols.
        using var output = new FileStream(outputPath, FileMode.CreateNew, FileAccess.Write);
        using var zip = new ZipArchive(output, ZipArchiveMode.Create);
        foreach (var symbol in symbols.OrderBy(symbol => symbol.Name, StringComparer.Ordinal))
        {
            using var entry = zip.CreateEntry(symbol.Name).Open();
            entry.Write(symbol.Data);
        }
    }

    private static void AddAvailableSymbols(ZipArchive bundle, List<(string Name, byte[] Data)> symbols,
        Func<string, byte[]?>? findPublicSymbols, string? symbolCacheDir, Func<string, byte[]?>? findVendorSymbols,
        bool includeExternalSymbols)
    {
        var fetch = findPublicSymbols ?? (id => DownloadPublicSymbols(id, SymbolClient).GetAwaiter().GetResult());
        var lookup = (Func<string, byte[]?>)(id => FetchPublicSymbols(id, symbolCacheDir, fetch));
        var vendorBase = VendorSymbolsBaseUrl;
        Func<string, byte[]?>? vendorLookup = null;
        if (findVendorSymbols is not null || vendorBase is not null)
        {
            var vendorFetch = findVendorSymbols ??
                (Func<string, byte[]?>)(id => DownloadVendorSymbols(id, vendorBase!, SymbolClient).GetAwaiter().GetResult());
            vendorLookup = id => FetchPublicSymbols(id, symbolCacheDir, vendorFetch);
        }
        var covered = symbols.Select(symbol => symbol.Name).ToHashSet(StringComparer.Ordinal);
        foreach (var entry in bundle.Entries.OrderBy(entry => entry.FullName, StringComparer.Ordinal))
        {
            if (!entry.FullName.StartsWith("base/lib/arm64-v8a/lib", StringComparison.Ordinal) ||
                !entry.FullName.EndsWith(".so", StringComparison.Ordinal))
            {
                continue;
            }
            var name = entry.FullName["base/lib/".Length..];
            if (name.Split('/').Length != 2)
            {
                throw new InvalidDataException("Unexpected bundled native library layout");
            }
            if (covered.Contains(name) || IsDataContainer(name))
            {
                continue;
            }
            using var input = entry.Open();
            using var bytes = new MemoryStream();
            input.CopyTo(bytes);
            var shipped = bytes.ToArray();
            var buildId = ReadBuildId(shipped, requireSymbols: false);
            byte[]? debug;
            if (HasSymbols(shipped))
            {
                debug = shipped;
            }
            else if (includeExternalSymbols && SupportedPublicBuildId(buildId))
            {
                debug = lookup(buildId) ?? vendorLookup?.Invoke(buildId);
            }
            else
            {
                debug = null;
            }
            if (debug is null)
            {
                continue;
            }
            VerifyBundled(bundle, name, debug);
            symbols.Add((name, debug));
        }
    }

    internal static bool IsDataContainer(string name) =>
        name[(name.LastIndexOf('/') + 1)..] is "libassembly-store.so" ||
        name[(name.LastIndexOf('/') + 1)..].StartsWith("libassemblies.", StringComparison.Ordinal);

    private static bool HasSymbols(byte[] bytes)
    {
        try { ReadBuildId(bytes, requireSymbols: true); return true; }
        catch (InvalidDataException) { return false; }
    }

    private static bool SupportedPublicBuildId(string id) =>
        id.Length is >= 16 and <= 40 && id.Length % 2 == 0 && id.All(Uri.IsHexDigit);

    /// <summary>
    /// #3444: public-store downloads are cached by their exact GNU build ID, so
    /// identical runtime/vendor ELFs are fetched once per SDK/dependency set —
    /// never once per app commit or version bump. Only files that pass the same
    /// strict ELF/ABI/size/identity validation as a fresh download enter the
    /// cache; app-owned .dbg.so sidecars never touch it, so a sidecar can never
    /// be reused across application builds. Corrupt or mismatched entries are
    /// evicted and fetched again; misses are never negatively cached.
    /// </summary>
    private static byte[]? FetchPublicSymbols(string buildId, string? cacheDir, Func<string, byte[]?> fetch)
    {
        string? path = null;
        if (!string.IsNullOrEmpty(cacheDir))
        {
            path = Path.Join(cacheDir, buildId.ToLowerInvariant());
            if (File.Exists(path))
            {
                var cached = File.ReadAllBytes(path);
                if (ValidPublicSymbols(cached, buildId))
                {
                    return cached;
                }
                File.Delete(path);
            }
        }
        var debug = fetch(buildId);
        if (debug is null)
        {
            return null;
        }
        if (!ValidPublicSymbols(debug, buildId))
        {
            throw new InvalidDataException("Downloaded native symbols do not match the requested ELF build ID");
        }
        if (path is not null)
        {
            Directory.CreateDirectory(cacheDir!);
            var temp = path + ".tmp";
            File.WriteAllBytes(temp, debug);
            File.Move(temp, path, overwrite: true);
        }
        return debug;
    }

    private static bool ValidPublicSymbols(byte[] bytes, string buildId)
    {
        if (bytes.Length == 0 || bytes.Length > MaximumSymbolBytes)
        {
            return false;
        }
        try
        {
            return ReadBuildId(bytes, true).Equals(buildId, StringComparison.OrdinalIgnoreCase);
        }
        catch (InvalidDataException) { return false; }
    }

    internal static async Task<byte[]?> DownloadPublicSymbols(string buildId, HttpClient client)
    {
        if (!SupportedPublicBuildId(buildId))
        {
            throw new ArgumentException("Unsupported public ELF build ID", nameof(buildId));
        }
        // Microsoft's SSQP ELF symbol key, also used by dotnet-symbol/PerfView:
        // https://github.com/microsoft/perfview/blob/main/src/TraceEvent/Symbols/SymbolReader.cs
        return await DownloadSymbols(
            new Uri($"https://msdl.microsoft.com/download/symbols/_.debug/elf-buildid-sym-{buildId.ToLowerInvariant()}/_.debug"),
            buildId, client);
    }

    /// <summary>
    /// #3440: fetches a supplier-published debug ELF addressed by the shipped
    /// library's GNU build ID under a flat base URL ({base}/{build-id}). The
    /// response passes the same ELF/ABI/size/identity gate as a Microsoft
    /// store download before it may enter the archive or the cache.
    /// </summary>
    internal static async Task<byte[]?> DownloadVendorSymbols(string buildId, string baseUrl, HttpClient client)
    {
        if (!SupportedPublicBuildId(buildId))
        {
            throw new ArgumentException("Unsupported vendor ELF build ID", nameof(buildId));
        }
        // Absolute https only — a relative or non-HTTP base could reach local
        // files or unexpected endpoints through Uri resolution, and a remote
        // http store would let an intermediary substitute tampered symbols
        // (the build ID is no secret; the identity gate cannot detect it).
        // Loopback http stays allowed so tests can serve real responses.
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri) ||
            baseUri.Scheme is not ("https" or "http") ||
            (baseUri.Scheme == "http" && !baseUri.IsLoopback))
        {
            throw new ArgumentException("Vendor symbols base URL must be an absolute https URL", nameof(baseUrl));
        }
        return await DownloadSymbols(
            new Uri($"{baseUrl.TrimEnd('/')}/{buildId.ToLowerInvariant()}"), buildId, client);
    }

    private static async Task<byte[]?> DownloadSymbols(Uri uri, string buildId, HttpClient client)
    {
        using var deadline = new CancellationTokenSource(ColdDownloadDeadline);
        using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > MaximumSymbolBytes)
        {
            throw new InvalidDataException("Downloaded native symbols exceed the size limit");
        }
        using var input = await response.Content.ReadAsStreamAsync(deadline.Token);
        using var output = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await input.ReadAsync(buffer, deadline.Token)) != 0)
        {
            if (output.Length + read > MaximumSymbolBytes)
            {
                throw new InvalidDataException("Downloaded native symbols exceed the size limit");
            }
            output.Write(buffer, 0, read);
        }
        var symbols = output.ToArray();
        if (!ValidPublicSymbols(symbols, buildId))
        {
            throw new InvalidDataException("Downloaded native symbols do not match the requested ELF build ID");
        }
        return symbols;
    }

    /// <summary>
    /// Re-validates a packaged symbols archive against the AAB it deploys beside.
    /// Play rejects a malformed archive only after the bundle is already
    /// uploaded (#2970), so packaging and deployment run this over the stored
    /// zip before any store write. Returns the bundled arm64 libraries the
    /// archive does not cover. Missing public/vendor symbols and SDK data stores
    /// remain explicit; partial coverage is never reported as complete.
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
                if (IsDataContainer(entry.FullName))
                {
                    throw new InvalidDataException("Assembly-store data is not native debug symbols");
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
