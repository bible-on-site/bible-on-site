using Xunit;

namespace BibleOnSite.Tests.Support;

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class PreferencesServiceCollection
{
    public const string Name = "PreferencesService singleton";
}
