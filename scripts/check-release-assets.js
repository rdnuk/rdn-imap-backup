'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const assetName = process.argv[2];

function usage() {
  console.error('Usage: node scripts/check-release-assets.js <asset-name>');
  process.exit(1);
}

if (!GITHUB_REPOSITORY) {
  console.error('Missing GITHUB_REPOSITORY environment variable.');
  usage();
}

if (!assetName) {
  usage();
}

const [owner, repo] = GITHUB_REPOSITORY.split('/');
if (!owner || !repo) {
  console.error(`Invalid GITHUB_REPOSITORY: ${GITHUB_REPOSITORY}`);
  process.exit(1);
}

function fetchJson(url) {
  const headers = {
    'User-Agent': 'node.js',
    Accept: 'application/vnd.github+json',
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          return reject(new Error(`GitHub API request failed: ${res.statusCode} ${body}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('Too many redirects while downloading asset')); 
  }

  const headers = {
    'User-Agent': 'node.js',
    Accept: 'application/octet-stream',
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fs.unlinkSync(dest, { force: true });
        return resolve(downloadFile(new URL(res.headers.location, url).toString(), dest, redirectCount + 1));
      }
      if (res.statusCode >= 400) {
        fs.unlinkSync(dest, { force: true });
        return reject(new Error(`Asset download failed: ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (err) => {
        fs.unlinkSync(dest, { force: true });
        reject(err);
      });
    }).on('error', (err) => {
      fs.unlinkSync(dest, { force: true });
      reject(err);
    });
  });
}

async function main() {
  console.log('Fetching latest release metadata...');
  const release = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
  const asset = (release.assets || []).find((item) => item.name === assetName);
  if (!asset) {
    throw new Error(`Latest release does not contain asset: ${assetName}`);
  }

  console.log(`Found asset ${assetName} (size ${asset.size} bytes)`);
  const target = path.join(os.tmpdir(), `release-asset-${Date.now()}-${assetName}`);
  await downloadFile(asset.browser_download_url, target);

  const stats = fs.statSync(target);
  if (stats.size === 0) {
    throw new Error(`Downloaded asset is empty: ${assetName}`);
  }

  console.log(`Downloaded asset successfully to ${target}`);
  fs.unlinkSync(target);
  console.log('Asset packaging check passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
