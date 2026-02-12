# Website downtime & stuck deployment incident – 2026-02-10

## Summary

**Two issues** occurred on 2026-02-10:

1. **Brief downtime 15:49–15:52 local** (Israel, UTC+2 → 13:49–13:52 UTC) during a CD deployment rolling update with a single ECS task.
2. **Stuck deployment (4+ hours)**: After the CD pushed image v0.2.242, the new ECS task definition (revision 10) failed health checks repeatedly (**36 failed tasks**), keeping the deployment permanently IN_PROGRESS.

**Root causes:** (a) single-task service has no redundancy during rollout; (b) the ECS container health check was misconfigured (curling the full homepage `/` via `127.0.0.1`, while the Next.js server wasn't listening on localhost due to `HOSTNAME` env var being overridden by the Fargate container runtime).

**Resolution:** Created task definition revision 11 with:
- Health check changed from `curl http://127.0.0.1:3000/` → `curl http://localhost:3000/api/health`
- Added `HOSTNAME=0.0.0.0` explicitly in the ECS task definition environment
- Deployment completed successfully with 0 health check failures

---

## Timeline (all times in local Israel, UTC+2)

| Time | Event |
|------|--------|
| 15:40:46 | **CD - AWS** workflow started (run ID 21867227254) |
| 15:44:49 | New image **v0.2.242** pushed to ECR as `latest` |
| 15:46:16 | CD completed. EventBridge → Lambda → ECS `UpdateService(forceNewDeployment=True)`. New deployment created with **task definition revision 10** (memory 2048 MB). |
| **15:49–15:52** | **Reported downtime.** Old task draining, new task starting. |
| 15:52+ | Traffic partially restored (new task serves during health check grace period, then fails and cycles). |
| 15:46–20:02 | **~4 hours of stuck deployment.** 36 tasks launched and failed health checks. ECS kept cycling: start task → health check fails → stop task → start new one. |
| 20:02 | **Fix applied:** Registered task definition revision 11 (fixed health check + HOSTNAME). Updated service. |
| 20:04 | New task (revision 11) started. |
| ~20:07 | Health check passed. Task marked HEALTHY. Old tasks drained. |
| ~20:09 | **Deployment completed. Service stable.** |

---

## Issue 1: Brief downtime (15:49–15:52)

### Root cause

The CD deployment pushed a new image to ECR, triggering an automatic ECS rolling update. With `DesiredCount: 1`, the service has no redundancy during the rollout. During the transition window (old task stopping, new task starting, Cloud Map DNS propagating), the website was briefly unreachable.

### Verified data

- **ECR push:** v0.2.242 pushed at 15:44:49 (confirmed via `aws ecr describe-images`)
- **ECS deployment:** Created at 15:46:16 (confirmed via `aws ecs describe-services`)
- **Website external check:** `curl https://xn--febl3a.co.il/` returned 200 OK after recovery

---

## Issue 2: Stuck deployment (4+ hours, 36 failed tasks)

### Root cause

The ECS container health check command was:
```
curl -sf --max-time 5 http://127.0.0.1:3000/ > /dev/null || exit 1
```

This failed for **two reasons**:

1. **`HOSTNAME` env var override:** The Dockerfile sets `ENV HOSTNAME="0.0.0.0"`, but ECS Fargate overrides the container's hostname at runtime. Next.js standalone server (`server.js`) reads `process.env.HOSTNAME` to determine the bind address. Container logs confirmed:
   ```
   - Local: http://ip-172-31-40-137.il-central-1.compute.internal:3000
   ```
   The server was binding to the **ENI IP**, not `0.0.0.0`/`127.0.0.1`. So `curl http://127.0.0.1:3000/` couldn't connect.

2. **Wrong health check endpoint:** Curling `/` (the full homepage, ~44KB SSR page) is fragile and slow. The project has purpose-built health endpoints:
   - `/api/health` — lightweight liveness probe (instant 200 OK)
   - `/api/health/ready` — readiness probe with warmup

### Task definition history

| Rev | Date | Health Check | Memory | Notes |
|-----|------|-------------|--------|-------|
| 1 | - | None | 512 | No health check |
| 5 | Jan 29 | `/api/health/ready` | 1024 | Correct endpoint |
| 6 | Feb 2 | None | 1024 | Removed during troubleshooting |
| 7 | Feb 2 | `localhost:3000/` | 1024 | Changed to homepage |
| 8 | Feb 2 | `wget localhost:3000/` | 1024 | Switched to wget |
| 9 | Feb 2 | `curl 127.0.0.1:3000/` | 1024 | Changed to curl + 127.0.0.1 |
| 10 | Feb 9 | `curl 127.0.0.1:3000/` | 2048 | Memory increased |
| **11** | **Feb 10** | **`curl localhost:3000/api/health`** | **2048** | **Fixed: proper endpoint + HOSTNAME env** |

### Fix applied

Registered task definition **revision 11** with:
```json
{
  "healthCheck": {
    "command": ["CMD-SHELL", "curl -sf --max-time 5 http://localhost:3000/api/health > /dev/null || exit 1"],
    "interval": 30,
    "timeout": 10,
    "retries": 5,
    "startPeriod": 120
  },
  "environment": [
    { "name": "HOSTNAME", "value": "0.0.0.0" },
    { "name": "NEXT_PUBLIC_ENV", "value": "production" }
  ]
}
```

Updated service: `aws ecs update-service --task-definition bible-on-site-website:11 --force-new-deployment`

Result: Deployment completed with **0 health check failures**.

---

## How to be notified of stale/stuck deployments

Currently there is **no alerting** when an ECS deployment is stuck or cycling. Recommended:

### Option A: CloudWatch Alarm on ECS deployment metrics (recommended)

```bash
# Alarm when failedTasks > 3 in 10 minutes (indicates stuck deployment)
aws cloudwatch put-metric-alarm \
  --alarm-name "ecs-website-deployment-failures" \
  --metric-name "FailedTaskCount" \
  --namespace "ECS/ContainerInsights" \
  --dimensions Name=ClusterName,Value=bible-on-site-cluster Name=ServiceName,Value=bible-on-site-website \
  --statistic Sum \
  --period 600 \
  --evaluation-periods 1 \
  --threshold 3 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions <SNS_TOPIC_ARN> \
  --region il-central-1
```

### Option B: CloudWatch Alarm on running task count

Alert when running tasks drops to 0 (website down):

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "ecs-website-no-running-tasks" \
  --metric-name "RunningTaskCount" \
  --namespace "ECS/ContainerInsights" \
  --dimensions Name=ClusterName,Value=bible-on-site-cluster Name=ServiceName,Value=bible-on-site-website \
  --statistic Minimum \
  --period 60 \
  --evaluation-periods 3 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --alarm-actions <SNS_TOPIC_ARN> \
  --region il-central-1
```

### Option C: Enable ECS deployment circuit breaker

In the ECS service's `DeploymentConfiguration`, set:
```json
{
  "DeploymentCircuitBreaker": {
    "Enable": true,
    "Rollback": true
  }
}
```

This automatically stops a failing deployment and rolls back to the last stable version after a threshold of failures. Prevents infinite cycling.

### Option D: External uptime monitoring

Use an external service (e.g. UptimeRobot, Pingdom, AWS Route 53 health checks) to monitor `https://xn--febl3a.co.il/api/health` and alert via email/Slack/SMS on failures.

---

## How to avoid downtime during future deployments

### 1. Run at least 2 tasks (strongest recommendation)

Set `DesiredCount: 2` on the website service. With `MinimumHealthyPercent: 100` and `MaximumPercent: 200`, ECS replaces one task at a time while the other serves traffic. **Zero-downtime rolling updates.**

```bash
aws ecs update-service \
  --cluster bible-on-site-cluster \
  --service bible-on-site-website \
  --desired-count 2 \
  --region il-central-1 \
  --profile AdministratorAccess-250598594267 \
  --no-cli-pager
```

**Cost impact:** ~$15–25/month additional Fargate cost (0.25 vCPU + 2GB memory for the extra task in il-central-1).

### 2. Enable deployment circuit breaker with rollback

Prevents stuck deployments from running indefinitely:
```bash
aws ecs update-service \
  --cluster bible-on-site-cluster \
  --service bible-on-site-website \
  --deployment-configuration "maximumPercent=200,minimumHealthyPercent=100,deploymentCircuitBreaker={enable=true,rollback=true}" \
  --region il-central-1 \
  --profile AdministratorAccess-250598594267 \
  --no-cli-pager
```

### 3. Keep health checks lightweight

Always use `/api/health` (liveness) or `/api/health/ready` (readiness) — never the full homepage. The current revision 11 already does this.

### 4. Ensure HOSTNAME=0.0.0.0 is set in task definition

The Dockerfile `ENV` can be overridden by ECS Fargate. Always set `HOSTNAME=0.0.0.0` explicitly in the task definition environment. Revision 11 already includes this.

---

## Verification commands

```bash
# Login
aws sso login --profile AdministratorAccess-250598594267

# Check service health
aws ecs describe-services --cluster bible-on-site-cluster --services bible-on-site-website \
  --region il-central-1 --profile AdministratorAccess-250598594267 \
  --query "services[0].{deployments:deployments,events:events[0:10],desiredCount:desiredCount,runningCount:runningCount}"

# Check current task definition
aws ecs describe-task-definition --task-definition bible-on-site-website \
  --region il-central-1 --profile AdministratorAccess-250598594267 \
  --query "taskDefinition.{rev:revision,healthCheck:containerDefinitions[0].healthCheck,env:containerDefinitions[0].environment}"

# Check ECR latest image
aws ecr describe-images --repository-name bible-on-site \
  --region il-central-1 --profile AdministratorAccess-250598594267 \
  --query "imageDetails[?contains(imageTags||[], 'latest')].{pushed:imagePushedAt,tags:imageTags}" \
  --output table
```

## References

- CD workflow: `.github/workflows/cd-aws.yml`
- ECR→ECS auto-deploy: `docs/aws/cloudformation/ecr-ecs-auto-deploy/`
- ECS services IaC: `docs/aws/cloudformation/ecs-services.yaml`
- Health endpoints: `web/bible-on-site/src/app/api/health/route.ts`, `.../health/ready/route.ts`
- ECR deploy script: `devops/deploy/ecr-deploy/`
