namespace BibleOnSite.Tests.Support;

// Process-wide environment changes must not overlap other test collections.
[CollectionDefinition("Process environment", DisableParallelization = true)]
public class ProcessEnvironmentCollection;
