"""
ECR to ECS Auto-Deploy Lambda Function

Triggered by EventBridge when an ECR image is pushed.
Forces a new deployment of the corresponding ECS service.

Zero-downtime strategy for services with DesiredCount=1:
  1. Temporarily scale DesiredCount to 2
  2. Force a new deployment (ECS starts a new task with the latest image)
  3. Wait for the new task to reach RUNNING state
  4. Scale DesiredCount back to 1 (ECS drains and stops the old task)

This ensures at least one healthy task is serving traffic at all times,
even for single-task services that would otherwise see brief downtime
during the rolling update.

⚠️ DISCLAIMER: This file is maintained as documentation to reflect the de-facto
Lambda code deployed in AWS. The actual Lambda was created via AWS CLI.

Deployment:
    cp ecr-to-ecs-deploy-lambda.py index.py
    zip lambda.zip index.py
    aws lambda update-function-code \
        --function-name ecr-to-ecs-deploy \
        --zip-file fileb://lambda.zip \
        --region il-central-1
    aws lambda update-function-configuration \
        --function-name ecr-to-ecs-deploy \
        --timeout 240 \
        --region il-central-1
"""

import boto3
import json
import os
import time


# Maximum time (seconds) to wait for the new deployment to stabilise
STABILISE_TIMEOUT = int(os.environ.get("STABILISE_TIMEOUT", "180"))
POLL_INTERVAL = 10  # seconds between checks


def handler(event, context):
    """
    Triggered by EventBridge when an ECR image is pushed.
    Forces a new deployment of the corresponding ECS service with zero-downtime.
    """
    print(f"Event received: {json.dumps(event)}")

    repo_name = event["detail"]["repository-name"]

    # Map ECR repo to ECS service
    repo_to_service = {
        "bible-on-site": "bible-on-site-website",
        "bible-on-site-api": "bible-on-site-api",
    }

    service_name = repo_to_service.get(repo_name)
    if not service_name:
        print(f"No ECS service mapping for repo: {repo_name}")
        return {"statusCode": 200, "body": "No action needed"}

    cluster_name = os.environ.get("ECS_CLUSTER_NAME", "bible-on-site-cluster")
    ecs = boto3.client("ecs")

    # ─── 1. Read current service state ───────────────────────────────────
    svc = ecs.describe_services(cluster=cluster_name, services=[service_name])
    current = svc["services"][0]
    original_desired = current["desiredCount"]
    print(
        f"Service {service_name}: desiredCount={original_desired}, "
        f"runningCount={current['runningCount']}"
    )

    needs_scale_up = original_desired < 2

    # ─── 2. Temporarily scale up if running a single task ────────────────
    if needs_scale_up:
        print(f"Scaling {service_name} to desiredCount=2 for zero-downtime deploy")
        ecs.update_service(
            cluster=cluster_name,
            service=service_name,
            desiredCount=2,
            forceNewDeployment=True,
        )
    else:
        # Already ≥2 tasks — just force the new deployment
        print(f"Service already has desiredCount={original_desired}, forcing deployment")
        ecs.update_service(
            cluster=cluster_name,
            service=service_name,
            forceNewDeployment=True,
        )

    # ─── 3. Wait for the new deployment to have a running task ───────────
    if needs_scale_up:
        deadline = time.time() + STABILISE_TIMEOUT
        new_task_healthy = False

        while time.time() < deadline:
            time.sleep(POLL_INTERVAL)
            svc = ecs.describe_services(cluster=cluster_name, services=[service_name])
            current = svc["services"][0]
            running = current["runningCount"]
            deployments = current["deployments"]
            print(
                f"  runningCount={running}, "
                f"deployments={len(deployments)} "
                f"({', '.join(d['status'] + ':' + str(d['runningCount']) for d in deployments)})"
            )

            # When we have 2+ running tasks, the new deployment is healthy
            if running >= 2:
                new_task_healthy = True
                print("New task is running — scaling back down")
                break

        if not new_task_healthy:
            print(
                f"⚠️ Timed out after {STABILISE_TIMEOUT}s waiting for new task. "
                f"Scaling back to {original_desired} anyway to avoid cost."
            )

        # ─── 4. Scale back to original desired count ─────────────────────
        ecs.update_service(
            cluster=cluster_name,
            service=service_name,
            desiredCount=original_desired,
        )
        print(f"Scaled {service_name} back to desiredCount={original_desired}")

    return {
        "statusCode": 200,
        "body": f"Zero-downtime deployment completed for {service_name}",
    }
