"""
ECR to ECS Auto-Deploy Lambda Function

Triggered by EventBridge when an ECR image is pushed.
Forces a new deployment of the corresponding ECS service.

⚠️ DISCLAIMER: This file is maintained as documentation to reflect the de-facto
Lambda code deployed in AWS. The actual Lambda was created via AWS CLI.
"""

import boto3
import json
import os


def handler(event, context):
    """
    Triggered by EventBridge when an ECR image is pushed.
    Forces a new deployment of the corresponding ECS service.
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

    response = ecs.update_service(
        cluster=cluster_name,
        service=service_name,
        forceNewDeployment=True,
    )

    print(
        f"ECS update-service response: {response['service']['serviceName']} - "
        f"deployments: {len(response['service']['deployments'])}"
    )

    return {"statusCode": 200, "body": f"Triggered deployment for {service_name}"}
