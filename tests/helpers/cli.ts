// Helper for running `php think <command>` inside the docker container.
// Phase-40 CLI command tests use this — bypassing HTTP entirely.
//
// Local-mode (STACK=local) is not supported here yet; CLI tests assume the
// docker stack from `bash scripts/start-server.sh` is up.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
  combined: string
}

export interface CliOptions {
  /** Command-line args passed after `php think`. */
  args: string[]
  /** Pass stdin to the process (used by interactive commands). */
  stdin?: string
  /** Override working directory inside the container; default is /app. */
  cwd?: string
  /** Override timeout in ms; default 60_000. */
  timeoutMs?: number
  /** Env vars to inject (e.g., for non-interactive prompts). */
  env?: Record<string, string>
}

const CONTAINER = process.env.FASTADMIN_PHP_CONTAINER ?? 'fastadmin-test-php-1'

/** Run `docker exec <container> php /app/think <args...>`. */
export function runThink(opts: CliOptions): CliResult {
  const dockerArgs = ['exec', '-i']
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    dockerArgs.push('-e', `${k}=${v}`)
  }
  if (opts.cwd) {
    dockerArgs.push('-w', opts.cwd)
  }
  dockerArgs.push(CONTAINER, 'php', '/app/think', ...opts.args)

  const res: SpawnSyncReturns<string> = spawnSync('docker', dockerArgs, {
    encoding: 'utf8',
    input: opts.stdin ?? '',
    timeout: opts.timeoutMs ?? 60_000,
    maxBuffer: 16 * 1024 * 1024,
  })

  return {
    exitCode: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    combined: `${res.stdout ?? ''}${res.stderr ?? ''}`,
  }
}

/** Run an arbitrary command inside the container (e.g. `ls`, `cat`). */
export function dockerExec(args: string[]): CliResult {
  const res = spawnSync('docker', ['exec', CONTAINER, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return {
    exitCode: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    combined: `${res.stdout ?? ''}${res.stderr ?? ''}`,
  }
}

/** Read a file from the container (or from the mounted fastAdmin/ on host). */
export function readContainerFile(path: string): string | null {
  const r = dockerExec(['cat', path])
  return r.exitCode === 0 ? r.stdout : null
}

/** Check if a file exists inside the container. */
export function containerFileExists(path: string): boolean {
  const r = dockerExec(['test', '-f', path])
  return r.exitCode === 0
}

/** Check if a directory exists inside the container. */
export function containerDirExists(path: string): boolean {
  const r = dockerExec(['test', '-d', path])
  return r.exitCode === 0
}

/** Remove file(s) inside the container. */
export function containerRm(path: string): CliResult {
  return dockerExec(['rm', '-rf', path])
}
