// Reference addon — demonstrates the four lifecycle methods + a hook handler.
// Real addons would put DB migrations / file copies into install(), etc.

export default class ExampleAddon {
  // Optional in-memory counter so tests can assert the hook actually fired.
  loginCount = 0

  async install(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[example] install')
  }

  async uninstall(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[example] uninstall')
  }

  async enable(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[example] enable')
  }

  async disable(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[example] disable')
  }

  async upgrade(from: string, to: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[example] upgrade ${from} → ${to}`)
  }

  // Hook handler — wired from info.json `hooks` map.
  onUserLogin(params: unknown): void {
    this.loginCount++
    // eslint-disable-next-line no-console
    console.log('[example] user_login_successed fired', { params, count: this.loginCount })
  }
}
