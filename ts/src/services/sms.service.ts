// Adapter-based SMS service. Mirrors PHP's `Sms` lib + the addon-pluggable
// behavior pattern (e.g. addons/alidayu registers an Alibaba adapter).
import { Injectable } from '@nestjs/common'

export interface SmsAdapter {
  name: string
  send(mobile: string, code: string, event: string): Promise<boolean>
}

/** Default test/dev adapter — succeeds for every send, matches PHP TestSmsEmsStub. */
export class MockSmsAdapter implements SmsAdapter {
  name = 'mock'
  async send(mobile: string, code: string, event: string): Promise<boolean> {
    // eslint-disable-next-line no-console
    console.log(`[sms.mock] → ${mobile} (event=${event}) code=${code}`)
    return true
  }
}

@Injectable()
export class SmsService {
  private adapters = new Map<string, SmsAdapter>()
  private currentName = 'mock'

  constructor() {
    this.register(new MockSmsAdapter())
  }

  register(adapter: SmsAdapter): void {
    this.adapters.set(adapter.name, adapter)
  }

  use(name: string): void {
    if (!this.adapters.has(name)) {
      throw new Error(`SMS adapter not registered: ${name}`)
    }
    this.currentName = name
  }

  current(): SmsAdapter {
    return this.adapters.get(this.currentName)!
  }

  async send(mobile: string, code: string, event: string): Promise<boolean> {
    return this.current().send(mobile, code, event)
  }
}
