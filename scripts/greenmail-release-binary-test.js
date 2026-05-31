'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GREENMAIL_VERSION = '2.1.8';
const TMP_ROOT = path.resolve(__dirname, '..', 'tmp', 'greenmail-release-binary-test');

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return undefined;
  return process.argv[index + 1];
}

function getFlag(name) {
  return process.argv.includes(name);
}

function downloadJson(url) {
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
    return Promise.reject(new Error('Too many redirects while downloading the asset'));
  }

  const headers = {
    'User-Agent': 'node.js',
    Accept: 'application/octet-stream',
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(dest);
    https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fs.unlinkSync(dest, { force: true });
        return resolve(downloadFile(new URL(res.headers.location, url).toString(), dest, redirectCount + 1));
      }
      if (res.statusCode >= 400) {
        fs.unlinkSync(dest, { force: true });
        return reject(new Error(`Asset download failed: ${res.statusCode}`));
      }
      res.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(resolve));
      fileStream.on('error', (err) => {
        fs.unlinkSync(dest, { force: true });
        reject(err);
      });
    }).on('error', (err) => {
      fs.unlinkSync(dest, { force: true });
      reject(err);
    });
  });
}

function makeDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(host, port, retries = 20, intervalMs = 1000) {
  const net = require('net');
  for (let i = 0; i < retries; i += 1) {
    await wait(intervalMs);
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => {
          socket.end();
          resolve();
        });
        socket.on('error', reject);
      });
      return;
    } catch (_err) {
      // retry
    }
  }
  throw new Error(`Port ${port} on ${host} did not become available`);
}

function spawnBinary(binary, cwd, env) {
  const result = spawnSync(binary, [], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Binary exited with status ${result.status}`);
  }
}

function runGreenMailJar(jarPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('java', ['-jar', jarPath], {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    proc.on('error', reject);
    proc.stdout && proc.stdout.on('data', () => {});
    proc.stderr && proc.stderr.on('data', () => {});
    resolve(proc);
  });
}

function createConfigFile(configRoot, backupDir) {
  const config = {
    accounts: [
      {
        name: 'GreenMail Release Binary Test',
        host: 'localhost',
        port: 3143,
        secure: false,
        auth: {
          user: 'test@localhost',
          pass: 'password',
        },
        mailboxes: ['INBOX'],
        backupDir,
      },
    ],
    backup: {
      format: 'eml',
      incrementalOnly: false,
      concurrentAccounts: 1,
      logDir: path.join(configRoot, 'logs'),
    },
  };

  const configPath = path.join(configRoot, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return configPath;
}

async function sendTestMessage() {
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: 'localhost',
    port: 3025,
    secure: false,
    tls: { rejectUnauthorized: false },
  });

  const info = await transport.sendMail({
    from: 'sender@localhost',
    to: 'test@localhost',
    subject: 'Release binary GreenMail smoke test',
    text: 'This is a release binary compatibility test email.',
  });

  console.log('Sent test message:', info.messageId);
}

function listFiles(dir) {
  const result = [];
  const stack = [''];
  while (stack.length) {
    const relative = stack.pop();
    const absolute = path.join(dir, relative);
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute)) {
        stack.push(path.join(relative, child));
      }
    } else if (stat.isFile()) {
      result.push(relative.replace(/\\/g, '/'));
    }
  }
  return result.sort();
}

async function toContainerPath(hostAbsolutePath) {
  const cwd = process.cwd();
  const relative = path.relative(cwd, hostAbsolutePath);
  return path.posix.join('/workspace', relative.replace(/\\/g, '/'));
}

async function runBinary(binaryPath, configPath, useDocker) {
  const env = { CONFIG_PATH: configPath };
  if (!useDocker) {
    spawnBinary(binaryPath, process.cwd(), env);
    return;
  }

  const containerBinary = toContainerPath(binaryPath);
  const containerConfig = toContainerPath(configPath);
  const command = `chmod +x ${containerBinary} && CONFIG_PATH=${containerConfig} ${containerBinary}`;
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--platform', 'linux/arm64',
      '--network', 'host',
      '-v', `${process.cwd()}:/workspace`,
      '-w', '/workspace',
      'ubuntu:22.04',
      'bash',
      '-lc', command,
    ],
    { stdio: 'inherit', env: process.env }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Dockerized binary exited with status ${result.status}`);
}

async function main() {
  const assetName = getArg('--asset-name');
  const binaryOutput = path.resolve(process.cwd(), getArg('--output') || 'latest-release-binary');
  const useDocker = getFlag('--use-docker') || process.env.USE_DOCKER === 'true';

  if (!assetName) {
    console.error('Usage: node scripts/greenmail-release-binary-test.js --asset-name <name> [--output <path>] [--use-docker]');
    process.exit(1);
  }

  if (!GITHUB_REPOSITORY) {
    console.error('Missing GITHUB_REPOSITORY environment variable.');
    process.exit(1);
  }

  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  if (!owner || !repo) {
    console.error(`Invalid GITHUB_REPOSITORY: ${GITHUB_REPOSITORY}`);
    process.exit(1);
  }

  const workingDir = path.resolve(TMP_ROOT, assetName.replace(/[^a-zA-Z0-9.-]/g, '_'));
  fs.rmSync(workingDir, { recursive: true, force: true });
  makeDir(workingDir);

  console.log('Fetching latest release metadata...');
  const release = await downloadJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
  const asset = (release.assets || []).find((item) => item.name === assetName);
  if (!asset) {
    throw new Error(`Latest release does not contain asset: ${assetName}`);
  }

  console.log(`Downloading ${assetName}...`);
  await downloadFile(asset.browser_download_url, binaryOutput);
  if (process.platform !== 'win32') {
    fs.chmodSync(binaryOutput, 0o755);
  }

  const jarDir = path.join(workingDir, 'greenmail');
  makeDir(jarDir);
  const jarPath = path.join(jarDir, `greenmail-standalone-${GREENMAIL_VERSION}.jar`);

  if (!fs.existsSync(jarPath)) {
    console.log('Downloading GreenMail JAR...');
    await downloadFile(
      `https://repo1.maven.org/maven2/com/icegreen/greenmail/${GREENMAIL_VERSION}/greenmail-${GREENMAIL_VERSION}.jar`,
      jarPath
    );
  }

  console.log('Starting GreenMail service...');
  const greenMailProcess = await runGreenMailJar(jarPath);
  try {
    await waitForPort('localhost', 3025);
    await waitForPort('localhost', 3143);

    await sendTestMessage();

    const runDir = path.join(workingDir, 'run');
    makeDir(runDir);
    const backupDir = path.join(runDir, 'backups');
    makeDir(backupDir);
    const configPath = createConfigFile(runDir, backupDir);

    console.log(`Running release binary: ${assetName}`);
    await runBinary(binaryOutput, configPath, useDocker);

    if (!fs.existsSync(backupDir)) {
      throw new Error('Backup directory was not created by the binary.');
    }

    const files = listFiles(backupDir).filter((f) => f.endsWith('.eml'));
    if (files.length === 0) {
      throw new Error(`No .eml backups were created in ${backupDir}`);
    }

    console.log(`Binary smoke test passed: ${files.length} backed-up .eml file(s)`);
  } finally {
    if (greenMailProcess && greenMailProcess.kill) {
      greenMailProcess.kill();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
