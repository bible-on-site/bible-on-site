# AWS Architecture

The following diagram illustrates the high-level architecture of the Bible On Site infrastructure on AWS.

## Architecture Diagram

![AWS Architecture](./architecture.svg)

## Component Details

### 1. DNS (Route53)

- **Hosted Zones**: `xn--febl3a.com` (תנך.com), `xn--febl3a.co.il` (תנך.co.il)
- **Records**: A records pointing to EC2 Nginx, wildcard and www CNAMEs

### 2. Entry Point (EC2 Nginx)

- **Role**: Reverse Proxy & SSL Termination
- **Configuration**: Manages certificates for `תנך.co.il` and `תנך.com`
- **Routing**: Uses the VPC DNS resolver (`172.31.0.2`) to resolve internal ECS service names via Cloud Map

### 3. Compute (ECS Fargate)

- **Cluster**: `bible-on-site-cluster`
- **Services**: Website, API
- **Networking**: Tasks run in VPC with Cloud Map service discovery

### 4. Service Discovery (Cloud Map)

- **Namespace**: `bible-on-site.local`
- **Function**: Automatically registers ECS task IPs so Nginx can route to them dynamically without a Load Balancer

### 5. Container Registry (ECR)

- **Repositories**: `bible-on-site`, `bible-on-site-api`
- Images are tagged with version numbers and `latest`
- **Lifecycle Policy**: Keeps last 15 images, automatically expires older images to control storage costs

### 6. Auto-Deploy (EventBridge + Lambda)

- **EventBridge Rule**: Listens for ECR image push events (tag: `latest`)
- **Lambda Function**: `ecr-to-ecs-deploy` triggers ECS service deployment
- **Flow**: ECR Push → EventBridge → Lambda → ECS UpdateService (forceNewDeployment)

### 7. Monitoring & Scaling (CloudWatch)

- **Log Groups**: `/ecs/bible-on-site-website` (180 days retention)
- **Auto Scaling**: Target Tracking on CPU (70%), Min 1 / Max 3 tasks
- **Alarms**: Auto-created by Target Tracking for scale-in/scale-out

