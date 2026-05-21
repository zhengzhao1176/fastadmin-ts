#!/usr/bin/env node
// fastadmin-ts CLI entrypoint. Mirrors PHP's `php think <cmd>`.
import 'reflect-metadata'
import { Command } from 'commander'
import { registerAll } from '../src/cli/commands/index.ts'

async function main(): Promise<void> {
  const prog = new Command()
  prog
    .name('think')
    .description('fastadmin-ts CLI — install, scaffold, manage')
    .version('0.0.1')
  registerAll(prog)
  await prog.parseAsync(process.argv)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
