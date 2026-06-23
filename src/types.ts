export interface BaseOption {
  uploadPath: string | string[]
  singleBackFiles?: string[]
  singleBack?: boolean
  debug?: boolean
  open?: boolean
  maxRetries?: number
  retryDelay?: number
  showBackFile?: boolean
  autoUpload?: boolean
  fancy?: boolean
  failOnError?: boolean
  concurrency?: number
}

export interface DeployRuntimeOption {
  outDir?: string
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

export type DeployFtpOption = vitePluginDeployFtpOption & DeployRuntimeOption

export interface DeployFtpResult {
  success: boolean
  targets: DeployTargetResult[]
  outDir: string
  totalFiles: number
  failedCount: number
}

export interface TempDir {
  path: string
  cleanup: () => void
}

export interface UploadResult {
  success: boolean
  file: string
  relativeFilePath: string
  name: string
  size: number
  retries: number
  error?: Error
}

export interface UploadTask {
  filePath: string
  relativeFilePath: string
  remotePath: string
  size: number
}

export interface UploadTaskGroup {
  relativeDir: string
  remoteDir: string
  tasks: UploadTask[]
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

export interface BackupSummary {
  title: string
  items: string[]
}
