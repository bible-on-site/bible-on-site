using Xunit;

namespace BibleOnSite.Tests.Support;

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class PreferencesServiceCollection
{
    // internal rather than public: Codacy S2339 requires publicly-visible
    // constants to become static read-only properties, while xUnit collection
    // attributes can only take compile-time constants.
    internal const string Name = "PreferencesService singleton";
}
