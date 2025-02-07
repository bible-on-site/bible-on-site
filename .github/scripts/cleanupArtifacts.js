const { Octokit } = require("@octokit/rest");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_REPOSITORY.split('/')[0];
const REPO = process.env.GITHUB_REPOSITORY.split('/')[1];
const SIZE_THRESHOLD = 2 * 1024 * 1024 * 1024; // 2GB

if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN is not set");
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function cleanupArtifacts() {
  try {
    let artifacts = [];
    let page = 1;
    let response;
    do {
      response = await octokit.actions.listArtifactsForRepo({
        owner: OWNER,
        repo: REPO,
        per_page: 100,
        page,
      });
      artifacts = artifacts.concat(response.data.artifacts);
      page++;
    } while (response.data.artifacts.length === 100);

    const totalSize = artifacts.reduce((sum, artifact) => sum + artifact.size_in_bytes, 0);
    console.log(`Total artifact size: ${totalSize} bytes`);

    if (totalSize <= SIZE_THRESHOLD) {
      console.log("No need to delete artifacts.");
      return;
    }

    // Sort artifacts by creation date (oldest first)
    artifacts.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (let artifact of artifacts) {
      if (totalSize <= SIZE_THRESHOLD) break;
      console.log(`Deleting artifact ${artifact.name} (${artifact.id}) - ${artifact.size_in_bytes} bytes`);
      await octokit.actions.deleteArtifact({
        owner: OWNER,
        repo: REPO,
        artifact_id: artifact.id,
      });
      // Update total size after deletion
      totalSize -= artifact.size_in_bytes;
    }
  } catch (err) {
    console.error("Error cleaning up artifacts:", err);
    process.exit(1);
  }
}

cleanupArtifacts();