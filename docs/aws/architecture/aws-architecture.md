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
- **Website Task Role**: `bible-on-site-website-task-role` — allows the website container to invoke the bulletin Lambda for PDF generation

### 3b. Compute (Lambda)

- **Bulletin PDF Generator**: `bible-on-site-bulletin` — Rust-based Lambda that generates PDF bulletins from Tanach perakim on demand
  - **Runtime**: `provided.al2023` (custom Rust binary)
  - **Invoked by**: Website ECS task via AWS SDK (`lambda:InvokeFunction`)
  - **Data**: Embedded Tanach text + articles from RDS MySQL
  - **Deployed via**: CI/CD ZIP package (not container image)

### 4. Service Discovery (Cloud Map)

- **Namespace**: `bible-on-site.local`
- **Function**: Automatically registers ECS task IPs so Nginx can route to them dynamically without a Load Balancer

### 5. Container Registry (ECR)

- **Repositories**: `bible-on-site` (website), `bible-on-site-api` (API)
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

### 8. Database (RDS MySQL)

- **Instance**: `tanah-mysql` (MySQL 8.4, db.t3.micro)
- **Storage**: 20GB gp3, encrypted with AWS-managed KMS key
- **Networking**: Private subnets only, accessible from ECS and Lambda via security group
- **Backups**: 7-day retention period
- **Credentials**: Stored in SSM Parameter Store (SecureString)

### Service Communication

```
User → nginx → ECS Website (Next.js)
                     │
                     ├─ Direct MySQL → RDS (articles, dedications)
                     │
                     └─ AWS SDK invoke → Lambda: bible-on-site-bulletin
                                              │
                                              ├─ Embedded Tanach data (pesukim, headers)
                                              └─ MySQL → RDS (articles for PDF)
```

The website invokes the bulletin Lambda directly via the AWS SDK (`@aws-sdk/client-lambda`) rather than through an HTTP endpoint. Lambda Function URLs are not available in `il-central-1`, so the ECS task role grants `lambda:InvokeFunction` permission instead.
