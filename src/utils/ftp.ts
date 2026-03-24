import { Client } from 'basic-ftp'
import chalk from 'chalk'
import type { FtpConfig, FtpConnectConfig, ValidFtpConfig } from '../types'

export const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function validateFtpConfig(config: FtpConfig): config is ValidFtpConfig {
  return !!(config.host && config.user && config.password)
}

export async function connectWithRetry(
  client: Client,
  config: FtpConnectConfig,
  maxRetries: number,
  retryDelay: number,
  silentLogs = false,
) {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      client.ftp.verbose = false
      await client.access({
        ...config,
        secure: true,
        secureOptions: { rejectUnauthorized: false, timeout: 60000 },
      })
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxRetries) {
        if (!silentLogs) {
          console.log(chalk.yellow(`⚠ 连接失败，${retryDelay}ms 后重试 (${attempt}/${maxRetries})`))
        }
        await sleep(retryDelay * attempt)
      }
    }
  }

  throw new Error(`❌ FTP 连接失败，已重试 ${maxRetries} 次: ${lastError?.message}`)
}
