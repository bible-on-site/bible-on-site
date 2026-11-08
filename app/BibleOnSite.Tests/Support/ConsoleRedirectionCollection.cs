namespace BibleOnSite.Tests.Support;

// Other collections must not log through a writer that a test is replacing/disposes.
[CollectionDefinition("Console redirection", DisableParallelization = true)]
public class ConsoleRedirectionCollection;
