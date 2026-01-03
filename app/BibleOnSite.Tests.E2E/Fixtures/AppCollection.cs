namespace BibleOnSite.Tests.E2E.Fixtures;

/// <summary>
/// Collection definition for tests that share the app fixture.
/// Tests in this collection will share the same app instance.
/// </summary>
[CollectionDefinition(nameof(AppCollection))]
public class AppCollection : ICollectionFixture<AppFixture>
{
}
