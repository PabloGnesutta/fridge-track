import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { config as configEnv } from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
configEnv({ path: join(__dirname, '../', '.env') });
import { handleRequest } from './http/requestHandler.js';
import { log } from './logger/logger.js';
import { db } from './db/db.js';
import { addAllowedEmail } from './db/allowedEmails.js';
import { startExpiryNotificationScheduler } from './scheduler/expiryNotifier.js';

// Testing address - always allow-listed on boot so signup never blocks it
// waiting on a manual manageAllowedEmails.js call. addAllowedEmail() is
// `INSERT OR IGNORE`, so this is a no-op once the row already exists.
addAllowedEmail(db, 'arg.maccraft@gmail.com');

createServer(
  handleRequest
).listen(
  process.env.PORT,
  async () => {
    log(' - Listening on port', process.env.PORT);
    startExpiryNotificationScheduler(db);
  }
);
