import build from 'pino-abstract-transport';
import fs from 'fs';
import path from 'path';

export default async function (opts) {
  const destination = opts.destination || 1;
  const stream = typeof destination === 'string' || typeof destination === 'number'
    ? fs.createWriteStream(destination, { flags: 'a' })
    : destination;

  return build(async function (source) {
    for await (const obj of source) {
      const { time, level, msg, err, ...rest } = obj;
      
      const date = new Date(time);
      const timestamp = date.toISOString().replace('T', ' ').slice(0, 19);
      
      const levelLabel = getLevelLabel(level).toUpperCase();
      const env = process.env.NODE_ENV || 'development';
      
      let logLine = `[${timestamp}] ${env}.${levelLabel}: ${msg}`;
      
      // Add context if there are extra fields
      if (Object.keys(rest).length > 0) {
        logLine += ` ${JSON.stringify(rest)}`;
      }
      
      logLine += '\n';

      // Add stack trace if error exists
      if (err && err.stack) {
        logLine += `${err.stack}\n`;
      } else if (obj.stack) {
         // Sometimes stack is directly on the object
         logLine += `${obj.stack}\n`;
      }

      stream.write(logLine);
    }
  });
}

function getLevelLabel(level) {
  switch (level) {
    case 10: return 'trace';
    case 20: return 'debug';
    case 30: return 'info';
    case 40: return 'warn';
    case 50: return 'error';
    case 60: return 'fatal';
    default: return 'info';
  }
}
