export interface BaseOption {
  uploadPath: string
  singleBackFiles?: string[]
  singleBack?: boolean
  open?: boolean
  maxRetries?: number
  retryDelay?: number
  showBackFile?: boolean
  autoUpload?: boolean
  fancy?: boolean
  failOnError?: boolean
  concurrency?: number
}

export interface FtpConfig {
  name?: string
  host?: string
  port?: number
  user?: string
  password?: string
  alias?: string
}

export type vitePluginDeployFtpOption =
  | (BaseOption & {
      ftps: FtpConfig[]
      defaultFtp?: string
    })
  | (BaseOption & FtpConfig)

export interface TempDir {
  path: string
  cleanup: () => void
}

export interface UploadResult {
  success: boolean
  file: string
  name: string
  size: number
  retries: number
  error?: Error
}

export interface UploadTask {
  filePath: string
  remotePath: string
  size: number
}

export interface FtpConnectConfig {
  host: string
  port: number
  user: string
  password: string
}

export interface DeployTargetResult {
  name: string
  totalFiles: number
  failedCount: number
  error?: Error
}

export type ValidFtpConfig = Required<Pick<FtpConfig, 'host' | 'user' | 'password'>> & FtpConfig
