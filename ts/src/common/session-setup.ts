import type { INestApplication } from '@nestjs/common'
import session from 'express-session'
import cookieParser from 'cookie-parser'

// We name our session cookie `PHPSESSID` so cross-cutting/smoke tests that
// inherited PHP-flavoured assertions (`expect(http.getCookie('PHPSESSID'))`)
// pass without modification. Memory store is fine for tests.
export function setupSession(app: INestApplication): void {
  app.use(cookieParser())
  app.use(session({
    name: 'PHPSESSID',
    secret: process.env.SESSION_SECRET ?? 'fastadmin-ts-test-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  }))
}
