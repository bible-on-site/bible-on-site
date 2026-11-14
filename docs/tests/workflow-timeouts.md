# Workflow job time limits

Every runner job must declare an integer `timeout-minutes` from 1 to 60.
Keep existing tighter limits. Cross Module CI uses 10 minutes: its observed
successful peak was 1.9 minutes. Reusable-workflow callers cannot declare this
field; their runner jobs declare it in the called workflow. Step timeouts do not
replace job timeouts.

The independent **Workflow timeout policy** CI job checks every `.yml` and `.yaml`
workflow on each PR, push to master and merge-group run. Cross Module CI requires
this job to succeed. Run the same checks locally from `devops`:

```sh
bun run test:workflow-timeouts
bun run verify:workflow-timeouts
```

## Runtime evidence

Measured on 2026-11-11 using GitHub Actions start/completion timestamps, excluding
queue time and skipped jobs. The sample covers the repository's 29 workflow
files, runs since 2026-10-12, up to 10 recent successful runs and 8 recent completed
runs per workflow, deduplicated by run ID. Reusable-workflow jobs are measured in
their caller runs. There were 216 runs, 955 completed job observations and 804
successful jobs, with no API errors. The sample is recent history, not a guarantee
for unobserved experimental jobs or future cold-cache builds.

| Successful job | Observed peak | Evidence |
| --- | ---: | --- |
| Microsoft Store deployment | 39.5 min | [Job](https://github.com/bible-on-site/bible-on-site/actions/runs/42221847740/job/127905584336) |
| iOS A/B shard | 35.5 min | [Job](https://github.com/bible-on-site/bible-on-site/actions/runs/42870971025/job/130026821193) |
| AWS deployment | 34.5 min | [Job](https://github.com/bible-on-site/bible-on-site/actions/runs/42711490134/job/129481889994) |
| Website CI | 30.5 min | [Job](https://github.com/bible-on-site/bible-on-site/actions/runs/43023005479/job/130536016757) |
| Cross Module CI | 1.9 min | [Job](https://github.com/bible-on-site/bible-on-site/actions/runs/43023005479/job/130564888680) |

No successful sampled job exceeded 39.5 minutes. A 60-minute ceiling allows about
52% headroom over that observed maximum while replacing the six-hour default.
Existing limits below an hour are retained, including backup and cleanup jobs.
The fixture leak behind [#3305](https://github.com/bible-on-site/bible-on-site/issues/3305)
is repaired separately; cancellation limits do not repair leaked child processes.

## Deployment impact and rollback

This policy also caps AWS deployment runner jobs. A timeout cancels the runner;
it does not roll back an already submitted ECS rollout, Lambda update, migration
or asset publication. Check the deployment's actual resource state before
retrying a cancelled job. No resource settings, public URLs or data formats are
changed. Revert the workflow-limit change to restore the previous runner budgets;
restoring a time limit does not undo a deployment already submitted to AWS.

Investigate a newly timed-out job and its critical path before changing a limit.
Do not raise a budget to mask a regression. Refresh the measured sample when
the workload materially changes.
