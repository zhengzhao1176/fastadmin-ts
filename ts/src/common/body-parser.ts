import type { INestApplication } from '@nestjs/common'
import bodyParser from 'body-parser'

// Match PHP-style request parsing: form-urlencoded for POST, JSON for JSON
// content-type. NestJS doesn't enable urlencoded body parsing by default at
// the Express level for application/x-www-form-urlencoded if not configured.
// This single helper keeps main.ts tidy.
export function setupBodyParsing(app: INestApplication): void {
  app.use(bodyParser.urlencoded({ extended: true, limit: '16mb' }))
  app.use(bodyParser.json({ limit: '16mb' }))
}
