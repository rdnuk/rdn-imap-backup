'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

async function waitForPort(host, port, retries = 20, intervalMs = 1000) {
  const net = require('net');
  for (let i = 0; i < retries; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    await new Promise((resolve) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        resolve();
      });
    });
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => {
          socket.end();
          resolve();
        });
        socket.on('error', reject);
      });
      return;
    } catch (_) {
      // continue
    }
  }
  throw new Error(`Port ${port} on ${host} did not become available in time`);
}

async function sendTestMessage() {
  const transport = nodemailer.createTransport({
    host: 'localhost',
    port: 3025,
    secure: false,
    tls: { rejectUnauthorized: false },
  });

  const info = await transport.sendMail({
    from: 'sender@localhost',
    to: 'test@localhost',
    subject: 'GreenMail IMAP backup smoke test',
    text: 'This is a test email for GreenMail integration.',
  });

  console.log('Sent test message id:', info.messageId);
}

async function main() {
  const workspaceRoot = path.resolve(__dirname, '..');
  const tempDir = path.join(workspaceRoot, 'tmp', 'greenmail-test');
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const configPath = path.join(tempDir, 'config.json');
  const backupDir = path.join(tempDir, 'backups');
  const config = {
    accounts: [
      {
        name: 'GreenMail Test Account',
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
      logDir: path.join(tempDir, 'logs'),
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  process.env.CONFIG_PATH = configPath;

  console.log('Waiting for GreenMail SMTP and IMAP ports...');
  await waitForPort('localhost', 3025);
  await waitForPort('localhost', 3143);

  await sendTestMessage();

  console.log('Running backup script against GreenMail...');
  const { runBackup } = require('../src/backup');
  await runBackup();

  const inboxDir = path.join(backupDir, 'INBOX');
  if (!fs.existsSync(inboxDir)) {
    throw new Error(`Expected backup folder not found: ${inboxDir}`);
  }

  const files = fs.readdirSync(inboxDir).filter((file) => file.endsWith('.eml'));
  if (files.length === 0) {
    throw new Error(`No backed-up .eml files found in ${inboxDir}`);
  }

  console.log(`GreenMail backup smoke test passed: found ${files.length} .eml file(s)`);
}

main().catch((err) => {
  console.error('GreenMail smoke test failed:', err);
  process.exit(1);
});
