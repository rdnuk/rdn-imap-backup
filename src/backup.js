'use strict';

const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const { createClient, fetchMessages } = require('./imapClient');
const logger = require('./logger');
const config = require('./config');

/**
 * Sanitises a string so it can be used safely as a file/directory name.
 * Replaces any characters that are invalid on Windows or Unix paths.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitiseName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 100);
}

/**
 * Derives a stable filename for an email from its envelope metadata.
 *
 * @param {object} envelope  - ImapFlow envelope object
 * @param {number} uid
 * @returns {string}
 */
function buildFilename(envelope, uid) {
  const date = envelope.date ? envelope.date.toISOString().slice(0, 10) : 'nodate';
  const subject = sanitiseName(envelope.subject || 'no-subject');
  return `${date}_uid-${uid}_${subject}.eml`;
}

/**
 * Loads the persisted backup state from disk.
 * The state is a map of { accountName: { mailboxPath: lastUid } }.
 *
 * @param {string} stateFilePath
 * @returns {object}
 */
function loadState(stateFilePath) {
  if (fs.existsSync(stateFilePath)) {
    try {
      const raw = fs.readFileSync(stateFilePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      logger.warn(`Could not parse state file, starting fresh: ${err.message}`);
    }
  }
  return {};
}

/**
 * Persists the backup state to disk atomically (write to tmp then rename).
 *
 * @param {string} stateFilePath
 * @param {object} state
 */
function saveState(stateFilePath, state) {
  const tmp = `${stateFilePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, stateFilePath);
}

/**
 * Backs up all configured mailboxes for a single account.
 *
 * @param {object} account     - Account entry from config.json
 * @param {object} backupCfg   - Global backup configuration
 * @param {object} state       - Full mutable state object (modified in place)
 * @param {string} stateFile   - Path to state file (saved after each mailbox)
 */
async function backupAccount(account, backupCfg, state, stateFile) {
  const accountKey = account.name;
  if (!state[accountKey]) state[accountKey] = {};

  const baseDir = path.resolve(account.backupDir || path.join('backups', sanitiseName(account.name)));
  logger.info(`\n=== Backing up account: ${account.name} ===`);

  let client;
  try {
    client = await createClient(account);
  } catch (err) {
    logger.error(`[${account.name}] Failed to connect: ${err.message}`);
    return;
  }

  const mailboxes = account.mailboxes && account.mailboxes.length > 0
    ? account.mailboxes
    : ['INBOX'];

  for (const mailboxPath of mailboxes) {
    const mailboxKey = mailboxPath;
    const mailboxDir = path.join(baseDir, sanitiseName(mailboxPath));
    fs.mkdirSync(mailboxDir, { recursive: true });

    const lastUid = backupCfg.incrementalOnly !== false
      ? (state[accountKey][mailboxKey] || 0)
      : 0;

    logger.info(`  Processing mailbox: ${mailboxPath}`);

    try {
      const highestUid = await fetchMessages(
        client,
        mailboxPath,
        lastUid,
        async (msg) => {
          const filename = buildFilename(msg.envelope, msg.uid);
          const filepath = path.join(mailboxDir, filename);

          if (fs.existsSync(filepath)) return;

          if (backupCfg.format === 'eml' || !backupCfg.format) {
            fs.writeFileSync(filepath, msg.source);
          } else if (backupCfg.format === 'json') {
            const parsed = await simpleParser(msg.source);
            const json = {
              uid: msg.uid,
              from: parsed.from?.text,
              to: parsed.to?.text,
              subject: parsed.subject,
              date: parsed.date,
              text: parsed.text,
              html: parsed.html,
              attachments: (parsed.attachments || []).map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                size: a.size,
              })),
            };
            fs.writeFileSync(filepath.replace(/\.eml$/, '.json'), JSON.stringify(json, null, 2), 'utf8');
          }
        }
      );

      state[accountKey][mailboxKey] = highestUid;
      saveState(stateFile, state);
      logger.info(`  Finished "${mailboxPath}" — highest UID now ${highestUid}`);
    } catch (err) {
      logger.error(`  Error processing mailbox "${mailboxPath}": ${err.message}`);
    }
  }

  try {
    await client.logout();
    logger.info(`[${account.name}] Disconnected`);
  } catch (_) {
    // Ignore logout errors
  }
}

/**
 * Runs a full backup cycle across all accounts in the configuration.
 */
async function runBackup() {
  const backupCfg = config.backup || {};
  const stateFile = path.resolve('backup-state.json');
  const state = loadState(stateFile);

  const accounts = config.accounts || [];
  if (accounts.length === 0) {
    logger.warn('No accounts configured — nothing to do.');
    return;
  }

  const concurrentAccounts = backupCfg.concurrentAccounts || 1;

  for (let i = 0; i < accounts.length; i += concurrentAccounts) {
    const batch = accounts.slice(i, i + concurrentAccounts);
    await Promise.all(
      batch.map((account) => backupAccount(account, backupCfg, state, stateFile))
    );
  }

  logger.info('\nBackup complete.');
}

module.exports = { runBackup };
