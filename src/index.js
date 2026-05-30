'use strict';


const logger = require('./logger');
const config = require('./config');
const { runBackup } = require('./backup');

async function main() {
  logger.info('IMAP Backup starting…');
  logger.info(`Loaded ${config.accounts.length} account(s) from ${config.CONFIG_PATH}`);

  try {
    await runBackup();
    process.exit(0);
  } catch (err) {
    logger.error(`Unhandled error during backup: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

main();
