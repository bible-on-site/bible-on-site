# CD Workflow

| Workflow | Purpose |
|----------|----------|
| [`cd-aws.yml`](../../../../.github/workflows/cd-aws.yml) | AWS ECR/ECS Deployment (Website, API) |
| [`cd-app.yml`](../../../../.github/workflows/cd-app.yml) | App Store Deployment (Google Play, Microsoft Store) |
| [`cd-data.yml`](../../../../.github/workflows/cd-data.yml) | Data Deployment pipeline |

## App Store Deployment (`cd-app.yml`)

Triggered on push to master (via `app-package.yml` artifacts).

### Platforms

| Platform | Store | Artifact | Tool |
|----------|-------|----------|------|
| Android | Google Play | `.aab` | `r0adkll/upload-google-play` |
| Windows | Microsoft Store | `.msix` | `isaacrlevin/windows-store-action` |

### Key Secrets
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: Service account for Play Console API
- `ANDROID_SIGNING_KEY_*`: Keystore for AAB signing
- `MS_STORE_TENANT_ID`, `MS_STORE_CLIENT_ID`, `MS_STORE_CLIENT_SECRET`: Azure AD app for Partner Center API
- `MS_STORE_SELLER_ID`, `MS_STORE_FLIGHT_ID`: Store identifiers

### Version Strategy
- **Display Version**: Semantic (e.g., `4.0.6`)
- **Windows ApplicationVersion**: Small incrementing value (≤65535 per MSIX spec)
- **Android versionCode**: Large value continuing Play Store sequence (e.g., `40000020`)

## Architecture
![cd](./cd.svg)