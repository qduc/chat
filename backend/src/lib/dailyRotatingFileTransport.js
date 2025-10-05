import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { inspect } from 'util';
import build from 'pino-abstract-transport';

export default async function (options) {
  const { file = './logs/app', extension = '.log' } = options;

  let currentDate = null;
  let currentStream = null;

  function getLogFilePath() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    return `${file}-${date}${extension}`;
  }

  async function ensureLogDirectory(filePath) {
    await mkdir(dirname(filePath), { recursive: true });
  }

  async function getOrCreateStream() {
    const today = new Date().toISOString().split('T')[0];

    if (currentDate !== today) {
      // Close existing stream if it exists
      if (currentStream) {
        currentStream.end();
      }

      // Create new stream for today
      const logPath = getLogFilePath();
      await ensureLogDirectory(logPath);
      currentStream = createWriteStream(logPath, { flags: 'a' });
      currentDate = today;
    }

    return currentStream;
  }

  return build(async function (source) {
    for await (const obj of source) {
      const stream = await getOrCreateStream();
      stream.write(inspect(obj, { depth: null, colors: false }) + '\n');
    }
  });
}