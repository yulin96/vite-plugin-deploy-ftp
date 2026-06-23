import { resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { deployFtp } from './deploy'
import type { DeployFtpOption, vitePluginDeployFtpOption } from './types'
import { ensureTrailingSlash, normalizeSlash, normalizeUrlLikeBase } from './utils/path'

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
  ManifestConfig,
  ManifestFileItem,
  ManifestOption,
  ManifestPayload,
  TempDir,
  UploadResult,
  UploadTask,
  UploadTaskGroup,
  ValidFtpConfig,
  vitePluginDeployFtpOption,
} from './types'

export default function vitePluginDeployFtp(option: vitePluginDeployFtpOption): Plugin {
  const { open = true, configBase } = option || {}

  let buildFailed = false
  let upload = false
  let outDir = normalizeSlash(resolve('dist'))
  let resolvedConfig: ResolvedConfig | null = null
  const normalizedConfigBase = configBase ? ensureTrailingSlash(normalizeUrlLikeBase(configBase)) : undefined

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
      config.base = normalizedConfigBase || config.base
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
          configBase: normalizedConfigBase,
          outDir,
        })
      },
    },
  }
}
