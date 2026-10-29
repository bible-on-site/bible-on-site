# Wire website revalidation env into the admin task

**Status: proposed — requires Dorad's explicit approval before applying and
before merging the carrying pull request (AWS change approval rule).**
Tracked by issue #2763.

The deployed admin task definition (`bible-on-site-admin`) carries neither
`VITE_WEBSITE_URL` nor `REVALIDATE_SECRET`, so every post-commit
invalidation in `web/admin/src/server/website-revalidate.ts` is skipped and
the public website keeps serving cached content (including stale 404s)
while the admin UI reports success. The reference template already declares
the correct wiring (`docs/aws/cloudformation/ecs-services.yaml`,
`AdminTaskDefinition`), but those templates are documentation-only and the
live task definition was never updated. This runbook is the apply plan.

## Target state

On the admin task definition:

- `VITE_WEBSITE_URL=http://website.bible-on-site.local:3000` — the
  cluster-internal endpoint admin POSTs revalidation requests to (Cloud Map
  service discovery, same as the reference template).
- `REVALIDATE_SECRET` — ECS `secrets[]` entry resolving the **same** SSM
  SecureString the website task already uses:
  `arn:aws:ssm:il-central-1:<account-id>:parameter/bible-on-site-revalidate-secret`.
  Both sides must hold the identical value or every POST is rejected.

These are server-side only. `VITE_WEBSITE_URL` is intentionally read via
`process.env` at runtime and must **not** be baked into the bundle; the
public-facing origin for browser links is `VITE_PUBLIC_WEBSITE_URL`, set at
image build time in `web/admin/Dockerfile` (separate, non-AWS change).

## Preconditions to verify

```bash
# The shared secret must already exist (the website task reads it today):
aws ssm get-parameter --name bible-on-site-revalidate-secret \
  --region il-central-1 --query 'Parameter.Name' --output text

# Confirm the gap on the live task definition:
aws ecs describe-task-definition \
  --task-definition bible-on-site-admin --region il-central-1 \
  --query 'taskDefinition.containerDefinitions[].{env:environment,secrets:secrets}'

# Confirm service discovery resolves the website task (from inside the VPC):
dig website.bible-on-site.local
```

## Apply (manual task-definition revision — mirrors live ops, not the template)

```bash
# 1. Dump the current definition and add the two entries.
aws ecs describe-task-definition --task-definition bible-on-site-admin \
  --region il-central-1 --query taskDefinition > admin-taskdef.json

#    In admin-taskdef.json, inside the admin container definition:
#    environment[]: + { "name": "VITE_WEBSITE_URL",
#                       "value": "http://website.bible-on-site.local:3000" }
#    secrets[]:     + { "name": "REVALIDATE_SECRET",
#                       "valueFrom": "arn:aws:ssm:il-central-1:<account-id>:parameter/bible-on-site-revalidate-secret" }
#    Strip the read-only metadata keys (taskDefinitionArn, revision, status,
#    requiresAttributes, compatibilities, registeredAt, registeredBy).

# 2. Register the new revision and roll the service.
aws ecs register-task-definition --cli-input-json file://admin-taskdef.json \
  --region il-central-1
aws ecs update-service --cluster bible-on-site-cluster \
  --service bible-on-site-admin \
  --task-definition bible-on-site-admin:<new-revision> \
  --force-new-deployment --region il-central-1
```

## Impact and rollback

- Production effect: the next admin write triggers real POSTs to
  `http://website.bible-on-site.local:3000/api/revalidate`; a wrong secret
  fails closed (401 → recorded freshness warning, no public change).
- Backward compatibility: additive env/secrets only — no image, port,
  network, IAM or scaling changes. Task fails to start only if the SSM
  parameter is unreadable; the precondition check above catches that first.
- Rollback: `aws ecs update-service --service bible-on-site-admin
  --task-definition bible-on-site-admin:<previous-revision>`.

## Verify after deploy

```bash
# Trigger an admin-side save, then check the website actually expired:
curl -s -X POST "http://website.bible-on-site.local:3000/api/revalidate" \
  -H "x-revalidate-secret: <secret>" -H 'content-type: application/json' \
  -d '{"tag":"tanahpedia-entity-refs"}'   # from inside the VPC only
```

In the admin UI: save any pedia alias — the amber freshness banner must
stay absent (and an intentional probe save with a bad secret should surface
it). See `web/admin/src/components/RevalidationWarning.tsx`.
