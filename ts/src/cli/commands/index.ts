import type { Command } from 'commander'
import { register as registerInstall } from './install.ts'
import { register as registerCrud } from './crud.ts'
import { register as registerMenu } from './menu.ts'
import { register as registerAddon } from './addon.ts'
import { register as registerMin } from './min.ts'
import { register as registerApi } from './api.ts'

export function registerAll(prog: Command): void {
  registerInstall(prog)
  registerCrud(prog)
  registerMenu(prog)
  registerAddon(prog)
  registerMin(prog)
  registerApi(prog)
}
