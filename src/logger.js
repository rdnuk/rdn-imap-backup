'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');
const config = require('./config');

const logDir = (config.backup && config.backup.logDir) || 'logs';
fs.mkdirSync(logDir, { recursive: true });

const logger = createLogger({
  level: (config.backup && config.backup.logLevel) || process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) => {
      const base = `${timestamp} [${level.toUpperCase()}] ${message}`;
      return stack ? `${base}\n${stack}` : base;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: path.join(logDir, 'backup.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

module.exports = logger;
