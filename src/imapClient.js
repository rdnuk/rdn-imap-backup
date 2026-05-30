'use strict';

const { ImapFlow } = require('imapflow');
const logger = require('./logger');

/**
 * Creates and returns a connected ImapFlow client for the given account config.
 * Caller is responsible for calling client.logout() when done.
 *
 * @param {object} account - Account configuration object from config.json
 * @returns {Promise<ImapFlow>}
 */
async function createClient(account) {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure !== false,
    auth: {
      user: account.auth.user,
      pass: account.auth.pass,
    },
    logger: false,
  });

  client.on('error', (err) => {
    logger.error(`[${account.name}] IMAP connection error: ${err.message}`);
  });

  await client.connect();
  logger.info(`[${account.name}] Connected to ${account.host}:${account.port}`);
  return client;
}

/**
 * Lists all available mailboxes for a connected client.
 *
 * @param {ImapFlow} client
 * @returns {Promise<string[]>} Array of mailbox paths
 */
async function listMailboxes(client) {
  const mailboxes = [];
  for await (const mailbox of client.listMailboxes({ subscribed: false })) {
    mailboxes.push(mailbox.path);
  }
  return mailboxes;
}

/**
 * Fetches messages from a mailbox that haven't been downloaded yet.
 * Uses UID-based fetching so results are deterministic across sessions.
 *
 * @param {ImapFlow} client
 * @param {string} mailboxPath
 * @param {number} lastUid - Last UID that was successfully backed up (0 = start fresh)
 * @param {Function} onMessage - Async callback invoked for each fetched message
 * @returns {Promise<number>} Highest UID processed in this run
 */
async function fetchMessages(client, mailboxPath, lastUid, onMessage) {
  const lock = await client.getMailboxLock(mailboxPath);
  let highestUid = lastUid;

  try {
    const { exists } = client.mailbox;

    if (!exists || exists === 0) {
      logger.info(`  Mailbox "${mailboxPath}" is empty — skipping`);
      return highestUid;
    }

    const searchQuery = lastUid > 0 ? { uid: `${lastUid + 1}:*` } : { all: true };
    const uids = await client.search(searchQuery, { uid: true });

    if (!uids || uids.length === 0) {
      logger.info(`  No new messages in "${mailboxPath}"`);
      return highestUid;
    }

    logger.info(`  Fetching ${uids.length} message(s) from "${mailboxPath}" (last UID: ${lastUid})`);

    for await (const msg of client.fetch(uids, { uid: true, source: true, envelope: true }, { uid: true })) {
      try {
        await onMessage(msg);
        if (msg.uid > highestUid) {
          highestUid = msg.uid;
        }
      } catch (err) {
        logger.error(`  Failed to process UID ${msg.uid}: ${err.message}`);
      }
    }
  } finally {
    lock.release();
  }

  return highestUid;
}

module.exports = { createClient, listMailboxes, fetchMessages };
