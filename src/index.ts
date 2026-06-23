import { resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { deployFtp } from './deploy'
import type { DeployFtpOption, vitePluginDeployFtpOption } from './types'
import { normalizeSlash } from './utils/path'

export { deployFtp }
export const defineDeployConfig = (option: DeployFtpOption): DeployFtpOption => option
export type {
  BackupSummary,
  BaseOption,
  DeployFtpOption,
  DeployFtpResult,
  DeployTargetResult,
  FtpConfig,
  FtpConnectConfig,
  TempDir,
  UploadResult,
  UploadTask,
  UploadTaskGroup,
  ValidFtpConfig,
  vitePluginDeployFtpOption,
} from './types'

export default function vitePluginDeployFtp(option: vitePluginDeployFtpOption): Plugin {
  const { open = true } = option || {}

  let buildFailed = false
  let upload = false
  let outDir = normalizeSlash(resolve('dist'))
  let resolvedConfig: ResolvedConfig | null = null

  return {
    name: 'vite-plugin-deploy-ftp',
    apply: 'build',
    enforce: 'post',
    buildEnd(error) {
      if (error) buildFailed = true
    },
    config(config) {
      if (!open || buildFailed) return

      upload = true
      return config
    },
    configResolved(config) {
      resolvedConfig = config
      outDir = normalizeSlash(resolve(config.root, config.build.outDir))
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        if (!open || !upload || buildFailed || !resolvedConfig) return

        await deployFtp({
          ...option,
          outDir,
        })
      },
    },
  }
}
