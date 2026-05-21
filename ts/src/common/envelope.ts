// Match the PHP baseline envelope shapes exactly. Two flavours:
//   api      — { code, msg, time, data }                 (time is a STRING)
//   admin    — { code, msg, data, url, wait }            (NO time)
// We expose helpers for both; controllers choose per module.

export interface ApiEnvelope<T = unknown> {
  code: number
  msg: string
  time: string
  data: T
}

export interface AdminEnvelope<T = unknown> {
  code: number
  msg: string
  data: T
  url: string
  wait: number
}

export function apiOk<T>(msg: string, data: T = null as unknown as T): ApiEnvelope<T> {
  return { code: 1, msg, time: String(Math.floor(Date.now() / 1000)), data }
}

export function apiErr<T>(msg: string, data: T = null as unknown as T, code = 0): ApiEnvelope<T> {
  return { code, msg, time: String(Math.floor(Date.now() / 1000)), data }
}

export function adminOk<T>(msg: string, data: T = '' as unknown as T, url = '', wait = 3): AdminEnvelope<T> {
  return { code: 1, msg, data, url, wait }
}

export function adminErr<T>(msg: string, data: T = '' as unknown as T, url = '', wait = 3): AdminEnvelope<T> {
  return { code: 0, msg, data, url, wait }
}
