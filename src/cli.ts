#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deployFtp } from './deploy'
import type { DeployFtpOption } from './types'

const DEFAULT_CONFIG_FILES = [
  'deploy-ftp.config.js',
  'deploy-ftp.config.mjs',
  'deploy-ftp.config.cjs',
  'deploy-ftp.config.json',
]

const helpText = `
Usage:
  deploy-ftp --config deploy-ftp.config.mjs
  deploy-ftp --outDir dist --uploadPath /public_html

Options:
  --config <path>          Config file path
  --outDir <path>          Local directory to upload, default dist
  --uploadPath <path>      FTP target directory, can be used multiple times
  --host <host>            FTP host
  --port <number>          FTP port, default 21
  --user <user>            FTP username
  --password <password>    FTP password
  --alias <url>            Public URL alias
  --concurrency <number>   Upload concurrency
  --maxRetries <number>    Retry times
  --retryDelay <number>    Retry delay in ms
  --auto-upload            Skip upload confirmation
  --single-back            Enable single-file backup
  --single-back-file <path>
  --show-back-file         Print backup file list
  --debug                  Show debug timing
  --no-fancy               Disable styled progress
  --no-fail-on-error       Do not exit with error on upload failure
  -h, --help               Show help
`.trim()

const readValue = (args: string[], index: number, name: string): string => {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

const appendValue = (current: string | string[] | undefined, value: string): string | string[] => {
  if (Array.isArray(current)) return [...current, value]
  return current ? [current, value] : value
}

const parseArgs = (args: string[]): { configPath?: string; option: Partial<DeployFtpOption>; help: boolean } => {
  const option: Partial<DeployFtpOption> = {}
  let configPath: string | undefined
  let help = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '-h':
      case '--help':
        help = true
        break
      case '--config':
        configPath = readValue(args, i, arg)
        i++
        break
      case '--outDir':
      case '--host':
      case '--user':
      case '--password':
      case '--alias': {
        const key = arg.slice(2) as keyof DeployFtpOption
        option[key] = readValue(args, i, arg) as never
        i++
        break
      }
      case '--uploadPath': {
        option.uploadPath = appendValue(option.uploadPath, readValue(args, i, arg))
        i++
        break
      }
      case '--single-back-file': {
        const value = readValue(args, i, arg)
        option.singleBackFiles = option.singleBackFiles ? [...option.singleBackFiles, value] : [value]
        i++
        break
      }
      case '--debug':
        option.debug = true
        break
      case '--auto-upload':
        option.autoUpload = true
        break
      case '--single-back':
        option.singleBack = true
        break
      case '--show-back-file':
        option.showBackFile = true
        break
      case '--no-fancy':
        option.fancy = false
        break
      case '--no-fail-on-error':
        option.failOnError = false
        break
      case '--port':
      case '--concurrency':
      case '--maxRetries':
      case '--retryDelay': {
        const key = arg.slice(2) as 'port' | 'concurrency' | 'maxRetries' | 'retryDelay'
        ;(option as Record<string, unknown>)[key] = Number(readValue(args, i, arg))
        i++
        break
      }
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return { configPath, option, help }
}

const findDefaultConfig = async (): Promise<string | undefined> => {
  for (const file of DEFAULT_CONFIG_FILES) {
    const filePath = resolve(file)
    try {
      await access(filePath)
      return filePath
    } catch {}
  }
}

const loadConfig = async (configPath?: string): Promise<Partial<DeployFtpOption>> => {
  const resolvedConfigPath = configPath ? resolve(configPath) : await findDefaultConfig()
  if (!resolvedConfigPath) return {}

  if (extname(resolvedConfigPath) === '.json') {
    return JSON.parse(await readFile(resolvedConfigPath, 'utf8')) as Partial<DeployFtpOption>
  }

  const mod = (await import(pathToFileURL(resolvedConfigPath).href)) as {
    default?: Partial<DeployFtpOption>
    deployFtp?: Partial<DeployFtpOption>
  }
  return mod.default || mod.deployFtp || {}
}

const main = async () => {
  const { configPath, option, help } = parseArgs(process.argv.slice(2))

  if (help) {
    console.log(helpText)
    return
  }

  const config = await loadConfig(configPath)
  await deployFtp({
    ...config,
    ...option,
  } as DeployFtpOption)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
