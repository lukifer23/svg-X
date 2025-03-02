// Script to create a GitHub release using GitHub's REST API
import fs from 'fs';
import path from 'path';
import https from 'https';

// Configuration - update these values
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Set your GitHub token as an environment variable
const REPO_OWNER = 'lukifer23'; // Your GitHub username
const REPO_NAME = 'svg-bolt'; // Your repository name
const TAG_NAME = 'v1.0.0';
const RELEASE_NAME = 'SVG Bolt v1.0.0 Windows Release';
const RELEASE_BODY = fs.readFileSync('RELEASE_NOTES.md', 'utf8');
const ASSETS = [
  {
    path: 'dist/SVG Bolt Setup 1.0.0.exe',
    name: 'SVG-Bolt-Setup-1.0.0.exe',
    contentType: 'application/octet-stream'
  }
];

if (!GITHUB_TOKEN) {
  console.error('Error: GitHub token not set. Set the GITHUB_TOKEN environment variable.');
  process.exit(1);
}

// Function to create a release
function createRelease() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      tag_name: TAG_NAME,
      name: RELEASE_NAME,
      body: RELEASE_BODY,
      draft: true,
      prerelease: false
    });

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases`,
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'SVG-Bolt-Release-Script',
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const response = JSON.parse(responseData);
            console.log(`Release created: ${response.html_url}`);
            resolve(response);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP Error: ${res.statusCode} - ${responseData}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Request error: ${e.message}`));
    });

    req.write(data);
    req.end();
  });
}

// Function to upload an asset to a release
function uploadAsset(releaseId, asset) {
  return new Promise((resolve, reject) => {
    const fileData = fs.readFileSync(asset.path);
    const fileName = path.basename(asset.path);

    const options = {
      hostname: 'uploads.github.com',
      path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`,
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'SVG-Bolt-Release-Script',
        'Content-Type': asset.contentType,
        'Content-Length': fileData.length
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const response = JSON.parse(responseData);
            console.log(`Asset uploaded: ${response.browser_download_url}`);
            resolve(response);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP Error: ${res.statusCode} - ${responseData}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Request error: ${e.message}`));
    });

    req.write(fileData);
    req.end();
  });
}

// Main function to create the release and upload assets
async function main() {
  try {
    console.log('Creating GitHub release...');
    const release = await createRelease();

    console.log('Uploading assets...');
    for (const asset of ASSETS) {
      await uploadAsset(release.id, asset);
    }

    console.log(`
Release created successfully!
---------------------------
Tag: ${TAG_NAME}
Name: ${RELEASE_NAME}
URL: ${release.html_url}
Status: Draft (you need to publish it manually on GitHub)
    `);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main(); 