'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(process.env.CONFIG_PATH || 'config.json');

const DEFAULT_CONFIG = {
  accounts: [
    {
      name: 'My Account',
      host: 'imap.example.com',
      port: 993,
      secure: true,
      auth: {
        user: 'user@example.com',
        pass: 'your-password-here',
      },
      mailboxes: ['INBOX', 'Sent'],
      backupDir: 'backups/my-account',
    },
  ],
  backup: {
    format: 'eml',
    incrementalOnly: true,
    concurrentAccounts: 1,
    logDir: 'logs',
  },
};

function createDefaultConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  console.log(`No config found — created a default config at: ${CONFIG_PATH}`);
  console.log('Edit it with your IMAP account details, then run again.');
  process.exit(0);
}

function load() {
  if (!fs.existsSync(CONFIG_PATH)) {
    createDefaultConfig();
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse config file: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(config.accounts) || config.accounts.length === 0) {
    console.error('No accounts defined in config.json — add at least one account.');
    process.exit(1);
  }

  return config;
}

const config = load();

module.exports = config;
module.exports.CONFIG_PATH = CONFIG_PATH;
