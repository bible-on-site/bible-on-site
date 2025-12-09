# AWS Architecture

The following diagram illustrates the high-level architecture of the Bible On Site infrastructure on AWS.

## Architecture Diagram

```mermaid
flowchart TD
    User((Internet User))

    subgraph "AWS Cloud (il-central-1)"

        subgraph "Public Subnet"
            Nginx["EC2: Nginx Reverse Proxy<br/>(SSL Termination)<br/>Public IP: &lt;MASKED&gt;"]
        end

        subgraph "VPC Private Network (172.31.0.0/16)"
            CloudMap["Cloud Map Service Discovery<br/>namespace: bible-on-site.local"]

            subgraph "ECS Fargate Cluster"
                WebsiteService["Service: bible-on-site-website<br/>Port: 3000"]
                ApiService["Service: bible-on-site-api<br/>Port: 3003 (Future)"]
            end
        end

        ECR[("ECR Repositories<br/>bible-on-site<br/>bible-on-site-api")]

        subgraph "Security & Identity"
            OIDC["GitHub OIDC Provider"]
            SSO["IAM Identity Center (SSO)"]
        end
    end

    %% Data Flow
    User -->|HTTPS / תנך.co.il| Nginx

    Nginx -- "1. Resolve DNS" --> CloudMap
    CloudMap -.->|Return Task IPs| Nginx

    Nginx -- "2. Proxy Traffic" --> WebsiteService

    %% Deployment / Infrastructure Flow
    OIDC -.->|Assume Role| ECR
    SSO -.->|Admin Access| ECR

    ECR -- "Pull Images" --> WebsiteService
    ECR -- "Pull Images" --> ApiService

    %% Styling
    classDef compute fill:#f9f,stroke:#333,stroke-width:2px;
    classDef storage fill:#ff9,stroke:#333,stroke-width:2px;
    classDef network fill:#dfd,stroke:#333,stroke-width:2px;

    class Nginx,WebsiteService,ApiService compute;
    class ECR storage;
    class CloudMap network;
```

## Component Details

### 1. Entry Point (EC2 Nginx)
- **Role**: Reverse Proxy & SSL Termination.
- **Configuration**: Manages certificates for `תנך.co.il` and `תנך.com`.
- **Routing**: Uses the VPC DNS resolver (`172.31.0.2`) to resolve internal ECS service names via Cloud Map.

### 2. Compute (ECS Fargate)
- **Cluster**: `bible-on-site-cluster`
- **Services**: Runs the application containers (Next.js website, Rust API).
- **Networking**: Tasks run in private subnets (logically) or public subnets with public IPs but restricted security groups.

### 3. Service Discovery (Cloud Map)
- **Namespace**: `bible-on-site.local`
- **Function**: Automatically registers ECS task IPs so Nginx can route to them dynamically without a Load Balancer.

### 4. Storage (ECR)
- Stores the Docker images for the application and API.
- Images are tagged with version numbers and `latest`.
