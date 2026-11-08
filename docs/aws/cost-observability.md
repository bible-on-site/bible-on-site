# AWS cost observability

Tooling for the recurring cost-safety checks behind
[#2576](https://github.com/bible-on-site/bible-on-site/issues/2576). The
2026-10-23 audit and the November 1 spend report were produced by hand; this
codifies them so audits stop depending on ad-hoc CLI recall.

Two halves:

1. **`devops/cost-audit.mjs`** — read-only audit: verified-account spend
   report plus guardrail drift detection and observability-gap reporting.
   Safe to run any time; it changes nothing.
2. **`docs/aws/cloudformation/cost-monitoring.yaml`** — reference-only IaC
   for the alerting half (budget, anomaly detection, billing alarm).
   Applying it creates real AWS resources and is a **gated #2576 change**:
   it needs Dorad's explicit approval like every AWS-impacting change.

## Running the audit

```bash
aws sso login --profile AdministratorAccess-250598594267
node devops/cost-audit.mjs                      # full audit
node devops/cost-audit.mjs --skip-spend         # guardrails only, zero Cost Explorer calls
node devops/cost-audit.mjs --months 6 --json    # six completed months, machine output
node devops/cost-audit.mjs --service "Amazon Simple Storage Service"  # daily S3 usage-type drill-down
```

Exit code is `1` when any guardrail drifts or cannot be verified, so the
script can be wired into a scheduled check later without format changes.
Cost Explorer bills a small per-request fee for its API; `--skip-spend`
performs none.

### Guardrails checked (a mismatch fails the audit)

| Check | Expected (audited baseline) | Cost risk if it drifts |
| --- | --- | --- |
| ECS log retention | website 180d, API/admin 365d | Unbounded log storage growth; "never expire" was the pre-audit state |
| ECS capacity | website/API `FARGATE` desired 1, admin `FARGATE_SPOT` desired 1 | Losing the admin Spot rollout (~$8/mo) or silently scaling public services |
| nginx router | `i-0d811651c11294634` running `t3.small` | Router down = site down; unapproved resize/AMI churn |
| VPC endpoints | SSM `vpce-0dd7903d30e03208c` + S3 `vpce-0388b3ea36b6a3214` available | Deleting them is gated; interface endpoints are also an hourly cost |
| Asset CDN | `E1WMX9UV9D2726` enabled with `Managed-CachingDisabled` | Edge caching is a gated behavior change, not an accepted state |

### Observability rows (informational, never fail)

AWS Budgets, Cost Explorer anomaly monitors, S3 request metrics and S3
access logging — the attribution gaps the November 1 report could not
close. Each row reports whether the tooling exists and where its proposal
lives.

## Cost-monitoring reference template

`cloudformation/cost-monitoring.yaml` documents three alerting layers:

- **Monthly budget** (`AWS::Budgets::Budget`): forecasted > 80% and actual >
  100% of `$150` (parameter default) emailed to the same mailbox as
  `ecs-deployment-alerts`.
- **Service anomaly detection** (`AWS::CE::AnomalyMonitor` +
  `AWS::CE::AnomalySubscription`): per-service dimensional monitor, daily
  digest above a `$25` impact.
- **Billing alarm** (`AWS::CloudWatch::Alarm` on `AWS/Billing
  EstimatedCharges`) publishing to a template-local us-east-1 SNS topic.

Thresholds are starting points — check current actuals with the audit
script before applying. Full prerequisites, apply/verify/rollback commands
and required permissions are in the template's `Metadata.Documentation`.
Notable prerequisites: `AWS/Billing` metrics exist only in `us-east-1`
(apply the stack there), and the alarm stays `INSUFFICIENT_DATA` until
"Receive Billing Alerts" is enabled in the Billing console — a console
preference outside CloudFormation's reach.

### Bucket-level attribution (still gated, not in the template)

- **S3 request metrics**:
  `aws s3api put-bucket-metrics-configuration --bucket bible-on-site-assets --id EntireBucket --metrics-configuration Id=EntireBucket`
  enables CloudWatch request metrics for the whole assets bucket.
- **S3 server access logging** needs a destination log bucket and prefix
  design first; keep it a separate approved change. Both were absent at the
  November 1 inspection and would have identified the 660 GB callers.

## Related documentation

- [cost-risk-audit-2026-10-23.md](cost-risk-audit-2026-10-23.md) — baseline
  this tooling watches, plus the gated migrations it must not touch.
- [s3-delivery-cost-2026-11-01.md](s3-delivery-cost-2026-11-01.md) — the
  billing evidence and attribution gap this closes.
- [admin-spot-rollout.md](admin-spot-rollout.md) — the Spot state the
  capacity guardrail protects, and its manual on-demand recovery.
