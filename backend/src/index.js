import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { config as configEnv } from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
configEnv({ path: join(__dirname, '../', '.env') });
import { handleRequest } from './http/requestHandler.js';
import { log } from './logger/logger.js';


createServer(
  handleRequest
).listen(
  process.env.PORT,
  async () => {
    log(' - Listening on port', process.env.PORT);
  }
);
