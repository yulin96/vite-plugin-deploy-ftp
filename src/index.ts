import { checkbox, select } from '@inquirer/prompts'
import { Client, FileType } from 'basic-ftp'
import chalk from 'chalk'
import dayjs from 'dayjs'
import fs from 'node:fs'
import { stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ora from 'ora'
import { normalizePath, Plugin, type ResolvedConfig } from 'vite'
import type {
  DeployTargetResult,
  FtpConfig,
  FtpConnectConfig,
  UploadResult,
  UploadTask,
  vitePluginDeployFtpOption,
} from './types'
import { connectWithRetry, sleep, validateFtpConfig } from './utils/ftp'
import { createTempDir, createZipFile, getAllFiles } from './utils/file'
import {
  normalizeFtpUploadPath,
  normalizeRemotePath,
  normalizeSelectionPath,
  normalizeUrlLikeBase,
  resolveDisplayUrl,
} from './utils/path'
import { buildCapsuleBar, formatBytes, formatDuration, trimMiddle } from './utils/progress'

export type {
  BaseOption,
  DeployTargetResult,
  FtpConfig,
  FtpConnectConfig,
  TempDir,
  UploadResult,
  UploadTask,
  ValidFtpConfig,
  vitePluginDeployFtpOption,
} from './types'

const backupArchivePattern = /^backup_\d{8}_\d{6}\.zip$/i

export default function vitePluginDeployFtp(option: vitePluginDeployFtpOption): Plugin {
  const safeOption = (option || {}) as vitePluginDeployFtpOption
  const {
    open = true,
    uploadPath = '',
    singleBack = false,
    singleBackFiles = ['index.html'],
    showBackFile = false,
    maxRetries = 3,
    retryDelay = 1000,
    autoUpload = false,
    fancy = true,
    failOnError = true,
    concurrency = 1,
  } = safeOption

  const isMultiFtp = 'ftps' in safeOption
  const ftpConfigs: FtpConfig[] = isMultiFtp
    ? safeOption.ftps || []
    : [{ ...safeOption, name: safeOption.name || safeOption.alias || safeOption.host }]
  const defaultFtp = isMultiFtp ? safeOption.defaultFtp : undefined
  const normalizedUploadPath = normalizeFtpUploadPath(uploadPath)

  let outDir = normalizePath(path.resolve('dist'))
  let upload = false
  let buildFailed = false
  let resolvedConfig: ResolvedConfig | null = null

  const useInteractiveOutput =
    fancy && Boolean(process.stdout?.isTTY) && Boolean(process.stderr?.isTTY) && !process.env.CI

  const clearScreen = () => {
    if (!useInteractiveOutput) return
    process.stdout.write('\x1b[2J\x1b[0f')
  }

  const validateOptions = (): string[] => {
    const errors: string[] = []

    if (!uploadPath) errors.push('uploadPath is required')
    if (!Number.isInteger(maxRetries) || maxRetries < 1) errors.push('maxRetries must be >= 1')
    if (!Number.isFinite(retryDelay) || retryDelay < 0) errors.push('retryDelay must be >= 0')
    if (!Number.isInteger(concurrency) || concurrency < 1) errors.push('concurrency must be >= 1')

    if (isMultiFtp) {
      if (!ftpConfigs.length) {
        errors.push('ftps is required and must not be empty')
      }

      if (defaultFtp && !ftpConfigs.some((ftp) => ftp.name === defaultFtp)) {
        errors.push(`defaultFtp "${defaultFtp}" does not match any ftp.name`)
      }

      const validConfigCount = ftpConfigs.filter(validateFtpConfig).length
      if (validConfigCount === 0) {
        errors.push('at least one ftp config requires host, user and password')
      }
    } else {
      const singleConfig = ftpConfigs[0]
      if (!singleConfig?.host) errors.push('host is required')
      if (!singleConfig?.user) errors.push('user is required')
      if (!singleConfig?.password) errors.push('password is required')
    }

    return errors
  }

  const uploadFileWithRetry = async (
    task: UploadTask,
    context: {
      client: Client
      ensureConnected: () => Promise<void>
      markDisconnected: () => void
      silentLogs: boolean
      maxRetries: number
      retryDelay: number
    },
  ): Promise<UploadResult> => {
    for (let attempt = 1; attempt <= context.maxRetries; attempt++) {
      try {
        await context.ensureConnected()

        const remoteDir = normalizePath(path.posix.dirname(task.remotePath))
        if (remoteDir && remoteDir !== '.') {
          await context.client.ensureDir(remoteDir)
        }

        await context.client.uploadFrom(task.filePath, path.posix.basename(task.remotePath))
        return {
          success: true,
          file: task.filePath,
          name: task.remotePath,
          size: task.size,
          retries: attempt - 1,
        }
      } catch (error) {
        context.markDisconnected()
        try {
          context.client.close()
        } catch {
          // ignore close errors
        }

        if (attempt === context.maxRetries) {
          if (!context.silentLogs) {
            console.log(
              `${chalk.red('✗')} ${task.filePath} => ${error instanceof Error ? error.message : String(error)}`,
            )
          }

          return {
            success: false,
            file: task.filePath,
            name: task.remotePath,
            size: task.size,
            retries: attempt - 1,
            error: error as Error,
          }
        }

        if (!context.silentLogs) {
          console.log(
            `${chalk.yellow('⚠')} ${task.filePath} 上传失败，正在重试 (${attempt}/${context.maxRetries})...`,
          )
        }
        await sleep(context.retryDelay * attempt)
      }
    }

    return {
      success: false,
      file: task.filePath,
      name: task.remotePath,
      size: task.size,
      retries: context.maxRetries,
      error: new Error('Max retries exceeded'),
    }
  }

  const uploadFilesInBatches = async (
    connectConfig: FtpConnectConfig,
    files: string[],
    targetDir: string,
    windowSize: number = concurrency,
  ): Promise<UploadResult[]> => {
    const results: UploadResult[] = []
    const totalFiles = files.length
    const tasks: UploadTask[] = []

    let completed = 0
    let failed = 0
    let uploadedBytes = 0
    let retries = 0

    const taskCandidates = await Promise.all(
      files.map(async (relativeFilePath) => {
        const filePath = normalizePath(path.resolve(outDir, relativeFilePath))
        const remotePath = normalizeRemotePath(targetDir, relativeFilePath)

        try {
          const fileStats = await stat(filePath)
          return { task: { filePath, remotePath, size: fileStats.size } as UploadTask }
        } catch (error) {
          return { task: null, error: error as Error, filePath, remotePath }
        }
      }),
    )

    for (const candidate of taskCandidates) {
      if (candidate.task) {
        tasks.push(candidate.task)
      } else {
        failed++
        completed++
        results.push({
          success: false,
          file: candidate.filePath,
          name: candidate.remotePath,
          size: 0,
          retries: 0,
          error: candidate.error,
        })
      }
    }

    const totalBytes = tasks.reduce((sum, task) => sum + task.size, 0)
    const startAt = Date.now()
    const safeWindowSize = Math.max(1, Math.min(windowSize, tasks.length || 1))
    const activeFiles = new Set<string>()
    const silentLogs = Boolean(useInteractiveOutput)

    const spinner = useInteractiveOutput ? ora({ text: '准备上传...', spinner: 'dots12' }).start() : null
    const reportEvery = Math.max(1, Math.ceil(totalFiles / 10))
    let lastReportedCompleted = -1

    const updateProgress = () => {
      const progressRatio = totalFiles > 0 ? completed / totalFiles : 1
      const percentage = Math.round(progressRatio * 100)
      const elapsedSeconds = (Date.now() - startAt) / 1000
      const speed = elapsedSeconds > 0 ? uploadedBytes / elapsedSeconds : 0
      const etaSeconds = speed > 0 ? Math.max(0, (totalBytes - uploadedBytes) / speed) : 0
      const activeList = Array.from(activeFiles)
      const currentFile = activeList.length > 0 ? trimMiddle(activeList[activeList.length - 1], 86) : '-'

      if (!spinner) {
        if (completed === lastReportedCompleted) return
        if (completed === totalFiles || completed % reportEvery === 0) {
          console.log(
            `${chalk.gray('进度:')} ${completed}/${totalFiles} (${percentage}%) | ${chalk.gray('数据:')} ${formatBytes(uploadedBytes)}/${formatBytes(totalBytes)} | ${chalk.gray('速度:')} ${formatBytes(speed)}/s`,
          )
          lastReportedCompleted = completed
        }
        return
      }

      const bar = buildCapsuleBar(progressRatio)
      const warnLine =
        retries > 0 || failed > 0
          ? `\n${chalk.yellow('重试')}: ${retries}  ${chalk.yellow('失败')}: ${failed}`
          : ''

      spinner.text = [
        `${chalk.cyan('正在上传:')} ${chalk.white(currentFile)}`,
        `${bar} ${chalk.bold(`${percentage}%`)} ${chalk.gray(`(${completed}/${totalFiles})`)} ${chalk.gray('|')} ${chalk.blue(formatBytes(uploadedBytes))}/${chalk.blue(formatBytes(totalBytes))} ${chalk.gray('|')} ${chalk.magenta(`${formatBytes(speed)}/s`)} ${chalk.gray('|')} 预计 ${chalk.yellow(formatDuration(etaSeconds))}`,
      ].join('\n')
      spinner.text += warnLine
    }

    const refreshTimer = spinner ? setInterval(updateProgress, 120) : null
    let currentIndex = 0

    const worker = async () => {
      const client = new Client()
      let connected = false

      const ensureConnected = async () => {
        if (connected) return
        await connectWithRetry(client, connectConfig, maxRetries, retryDelay, true)
        connected = true
      }

      const markDisconnected = () => {
        connected = false
      }

      try {
        while (true) {
          const index = currentIndex++
          if (index >= tasks.length) return

          const task = tasks[index]
          activeFiles.add(task.remotePath)
          updateProgress()

          const result = await uploadFileWithRetry(task, {
            client,
            ensureConnected,
            markDisconnected,
            silentLogs,
            maxRetries,
            retryDelay,
          })

          completed++
          retries += result.retries
          if (result.success) {
            uploadedBytes += result.size
          } else {
            failed++
          }
          results.push(result)
          activeFiles.delete(task.remotePath)
          updateProgress()
        }
      } finally {
        client.close()
      }
    }

    updateProgress()

    try {
      await Promise.all(Array.from({ length: safeWindowSize }, () => worker()))
    } finally {
      if (refreshTimer) clearInterval(refreshTimer)
    }

    if (spinner) {
      const elapsedSeconds = (Date.now() - startAt) / 1000
      const successCount = results.filter((item) => item.success).length
      const speed = elapsedSeconds > 0 ? uploadedBytes / elapsedSeconds : 0
      spinner.succeed(
        `${chalk.green('上传成功')} ${successCount} 个文件。\n${buildCapsuleBar(1)} 100% (${totalFiles}/${totalFiles}) ${chalk.gray('|')} 速度 ${chalk.magenta(`${formatBytes(speed)}/s`)} ${chalk.gray('|')} 耗时 ${chalk.yellow(formatDuration(elapsedSeconds))}`,
      )
    } else {
      console.log(`${chalk.green('✔')} 所有文件上传完成 (${totalFiles}/${totalFiles})`)
    }

    return results
  }

  const deploySingleTarget = async (ftpConfig: FtpConfig): Promise<DeployTargetResult> => {
    const { host, port = 21, user, password, alias = '', name } = ftpConfig
    const normalizedAlias = alias ? normalizeUrlLikeBase(alias) : ''

    if (!host || !user || !password) {
      console.error(chalk.red(`❌ FTP配置 "${name || host || '未知'}" 缺少必需参数:`))
      if (!host) console.error(chalk.red('  - 缺少 host'))
      if (!user) console.error(chalk.red('  - 缺少 user'))
      if (!password) console.error(chalk.red('  - 缺少 password'))
      return { name: name || host || 'unknown', totalFiles: 0, failedCount: 1 }
    }

    const allFiles = getAllFiles(outDir)
    const totalFiles = allFiles.length
    const displayName = name || host
    const startTime = Date.now()

    if (allFiles.length === 0) {
      console.log(`${chalk.yellow('⚠ 没有找到需要上传的文件')}`)
      return { name: displayName, totalFiles: 0, failedCount: 0 }
    }

    clearScreen()
    console.log(chalk.cyan(`\n🚀 FTP 部署开始\n`))
    console.log(`${chalk.gray('Server:')}   ${chalk.green(displayName)}`)
    console.log(`${chalk.gray('Host:')}     ${chalk.green(host)}`)
    console.log(`${chalk.gray('Source:')}   ${chalk.yellow(outDir)}`)
    console.log(`${chalk.gray('Target:')}   ${chalk.yellow(normalizedUploadPath)}`)
    if (normalizedAlias) console.log(`${chalk.gray('Alias:')}    ${chalk.green(normalizedAlias)}`)
    console.log(`${chalk.gray('Files:')}    ${chalk.blue(totalFiles)}\n`)

    const connectConfig: FtpConnectConfig = { host, port, user, password }
    const preflightClient = new Client()
    const preflightSpinner = useInteractiveOutput ? ora(`连接到 ${displayName}...`).start() : null

    try {
      await connectWithRetry(preflightClient, connectConfig, maxRetries, retryDelay, Boolean(preflightSpinner))
      if (preflightSpinner) preflightSpinner.succeed('连接成功')

      await preflightClient.ensureDir(normalizedUploadPath)
      const fileList = await preflightClient.list()

      if (fileList.length) {
        if (singleBack) {
          await createSingleBackup(
            preflightClient,
            normalizedUploadPath,
            normalizedAlias,
            singleBackFiles,
            showBackFile,
          )
        } else {
          const shouldBackup = await select({
            message: `是否备份 ${displayName} 的远程文件`,
            choices: ['否', '是'],
            default: '否',
          })

          if (shouldBackup === '是') {
            await createBackupFile(preflightClient, normalizedUploadPath, normalizedAlias, showBackFile)
          }
        }
      }

      const results = await uploadFilesInBatches(connectConfig, allFiles, normalizedUploadPath, concurrency)

      const successCount = results.filter((r) => r.success).length
      const failedCount = results.length - successCount
      const durationSeconds = (Date.now() - startTime) / 1000
      const duration = durationSeconds.toFixed(2)
      const uploadedBytes = results.reduce((sum, result) => (result.success ? sum + result.size : sum), 0)
      const retryCount = results.reduce((sum, result) => sum + result.retries, 0)
      const avgSpeed = durationSeconds > 0 ? uploadedBytes / durationSeconds : 0

      clearScreen()
      console.log('\n' + chalk.gray('─'.repeat(40)) + '\n')

      if (failedCount === 0) {
        console.log(`${chalk.green('🎉 部署成功!')}`)
      } else {
        console.log(`${chalk.yellow('⚠ 部署完成但存在错误')}`)
      }

      console.log(`\n${chalk.gray('统计:')}`)
      console.log(` ${chalk.green('✔')} 成功: ${chalk.bold(successCount)}`)
      if (failedCount > 0) {
        console.log(` ${chalk.red('✗')} 失败: ${chalk.bold(failedCount)}`)
      }
      console.log(` ${chalk.cyan('⇄')} 重试: ${chalk.bold(retryCount)}`)
      console.log(` ${chalk.blue('📦')} 数据: ${chalk.bold(formatBytes(uploadedBytes))}`)
      console.log(` ${chalk.magenta('⚡')} 平均速度: ${chalk.bold(`${formatBytes(avgSpeed)}/s`)}`)
      console.log(` ${chalk.blue('⏱')} 耗时: ${chalk.bold(duration)}s`)

      if (normalizedAlias) {
        console.log(
          ` ${chalk.green('🔗')} 访问地址: ${chalk.bold(resolveDisplayUrl(normalizedAlias, normalizedUploadPath))}`,
        )
      }

      console.log('')

      if (failedCount > 0) {
        const failedItems = results.filter((result) => !result.success)
        const previewCount = Math.min(5, failedItems.length)
        console.log(chalk.red('失败明细:'))
        for (let i = 0; i < previewCount; i++) {
          const item = failedItems[i]
          const reason = item.error?.message || 'unknown error'
          console.log(` ${chalk.red('•')} ${item.name} => ${reason}`)
        }
        if (failedItems.length > previewCount) {
          console.log(chalk.gray(` ... 还有 ${failedItems.length - previewCount} 个失败文件`))
        }
        console.log('')
      }

      return { name: displayName, totalFiles: results.length, failedCount }
    } catch (error) {
      if (preflightSpinner) preflightSpinner.fail(`❌ 上传到 ${displayName} 失败`)

      console.log(`\n${chalk.red('❌ 上传过程中发生错误:')} ${error}\n`)
      return {
        name: displayName,
        totalFiles,
        failedCount: totalFiles > 0 ? totalFiles : 1,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    } finally {
      preflightClient.close()
    }
  }

  const deployToFtp = async (): Promise<DeployTargetResult[]> => {
    if (!autoUpload) {
      const ftpUploadChoice = await select({
        message: '是否上传FTP',
        choices: ['是', '否'],
        default: '是',
      })
      if (ftpUploadChoice === '否') return []
    }

    let selectedConfigs: FtpConfig[] = []

    if (isMultiFtp) {
      if (defaultFtp) {
        const defaultConfig = ftpConfigs.find((ftp) => ftp.name === defaultFtp)
        if (defaultConfig && validateFtpConfig(defaultConfig)) {
          console.log(chalk.blue(`使用默认FTP配置: ${defaultFtp}`))
          selectedConfigs = [defaultConfig]
        } else if (defaultConfig) {
          console.log(chalk.yellow(`⚠ 默认FTP配置 "${defaultFtp}" 缺少必需参数，将进行手动选择`))
        }
      }

      if (selectedConfigs.length === 0) {
        const validConfigs = ftpConfigs.filter(validateFtpConfig)
        const invalidConfigs = ftpConfigs.filter((config) => !validateFtpConfig(config))

        if (invalidConfigs.length > 0) {
          console.log(chalk.yellow('\n以下FTP配置缺少必需参数，已从选择列表中排除:'))
          invalidConfigs.forEach((config) => {
            const missing = []
            if (!config.host) missing.push('host')
            if (!config.user) missing.push('user')
            if (!config.password) missing.push('password')
            console.log(chalk.yellow(`  - ${config.name || '未命名'}: 缺少 ${missing.join(', ')}`))
          })
          console.log()
        }

        if (validConfigs.length === 0) {
          console.error(chalk.red('❌ 没有可用的有效FTP配置'))
          return []
        }

        selectedConfigs = (await checkbox({
          message: '选择要上传的FTP服务器（可多选）',
          choices: validConfigs.map((ftp) => ({
            name: ftp.name || ftp.host || '未命名FTP',
            value: ftp,
          })),
          required: true,
        })) as FtpConfig[]
      }
    } else {
      const singleConfig = ftpConfigs[0] as FtpConfig
      if (validateFtpConfig(singleConfig)) {
        selectedConfigs = [{ ...singleConfig, name: singleConfig.name || singleConfig.host }]
      } else {
        const missing = []
        if (!singleConfig?.host) missing.push('host')
        if (!singleConfig?.user) missing.push('user')
        if (!singleConfig?.password) missing.push('password')
        console.error(chalk.red(`❌ FTP配置缺少必需参数: ${missing.join(', ')}`))
        return []
      }
    }

    const deployResults: DeployTargetResult[] = []

    for (const ftpConfig of selectedConfigs) {
      const targetResult = await deploySingleTarget(ftpConfig)
      deployResults.push(targetResult)
    }

    return deployResults
  }

  return {
    name: 'vite-plugin-deploy-ftp',
    apply: 'build',
    enforce: 'post',
    buildEnd(error) {
      if (error) buildFailed = true
    },
    config(config) {
      if (!open || buildFailed) return

      clearScreen()

      const validationErrors = validateOptions()
      if (validationErrors.length > 0) {
        console.log(`${chalk.red('✗ 配置错误:')}\n${validationErrors.map((err) => `  - ${err}`).join('\n')}`)
        return
      }

      upload = true
      return config
    },
    configResolved(config) {
      resolvedConfig = config
      outDir = normalizePath(path.resolve(config.root, config.build.outDir))
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        if (!open || !upload || buildFailed || !resolvedConfig) return

        const deployResults = await deployToFtp()
        if (deployResults.length === 0) return

        const failedTargets = deployResults.filter((target) => target.failedCount > 0)
        if (failedTargets.length > 0 && failOnError) {
          throw new Error(`Failed to deploy ${failedTargets.length} of ${deployResults.length} FTP targets`)
        }
      },
    },
  }
}

async function downloadRemoteFilesForBackup(
  client: Client,
  remoteDir: string,
  localDir: string,
  downloadedFiles: Array<{ remotePath: string; size: number }> = [],
) {
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true })
  }

  const remoteEntries = await client.list(remoteDir)

  for (const entry of remoteEntries) {
    const remotePath = normalizeRemotePath(remoteDir, entry.name)
    const localPath = path.join(localDir, entry.name)

    if (entry.type === FileType.Directory) {
      await downloadRemoteFilesForBackup(client, remotePath, localPath, downloadedFiles)
      continue
    }

    if (entry.type === FileType.SymbolicLink) {
      continue
    }

    if (backupArchivePattern.test(entry.name)) {
      continue
    }

    if (entry.type === FileType.File) {
      await client.downloadTo(localPath, remotePath)
      downloadedFiles.push({ remotePath, size: entry.size })
      continue
    }

    try {
      await client.downloadTo(localPath, remotePath)
      downloadedFiles.push({ remotePath, size: entry.size })
    } catch (downloadError) {
      try {
        await downloadRemoteFilesForBackup(client, remotePath, localPath, downloadedFiles)
      } catch {
        throw downloadError
      }
    }
  }

  return downloadedFiles
}

async function createBackupFile(
  client: Client,
  dir: string,
  alias: string,
  showBackFile: boolean = false,
) {
  const targetUrl = resolveDisplayUrl(alias, dir)
  const backupSpinner = ora(`创建备份文件中 ${chalk.yellow(`==> ${targetUrl}`)}`).start()

  const fileName = `backup_${dayjs().format('YYYYMMDD_HHmmss')}.zip`
  const tempDir = createTempDir('backup-zip')
  const zipFilePath = path.join(os.tmpdir(), 'vite-plugin-deploy-ftp', fileName)

  try {
    const zipDir = path.dirname(zipFilePath)
    if (!fs.existsSync(zipDir)) {
      fs.mkdirSync(zipDir, { recursive: true })
    }

    backupSpinner.text = `下载远程文件中 ${chalk.yellow(`==> ${targetUrl}`)}`

    const downloadedFiles = await downloadRemoteFilesForBackup(client, dir, tempDir.path)

    if (downloadedFiles.length === 0) {
      backupSpinner.warn('未找到可备份的远程文件')
      return
    }

    if (showBackFile) {
      console.log(chalk.cyan(`\n开始备份远程文件，共 ${downloadedFiles.length} 个文件:`))
      downloadedFiles.forEach((file) => {
        console.log(chalk.gray(`  - ${file.remotePath} (${file.size} bytes)`))
      })
    }

    backupSpinner.text = `下载远程文件成功 ${chalk.yellow(`==> ${targetUrl}`)}`

    await createZipFile(tempDir.path, zipFilePath)

    const backupRemotePath = normalizeRemotePath(dir, fileName)
    backupSpinner.text = `压缩完成, 准备上传 ${chalk.yellow(`==> ${resolveDisplayUrl(alias, backupRemotePath)}`)}`

    await client.uploadFrom(zipFilePath, backupRemotePath)

    const backupUrl = resolveDisplayUrl(alias, backupRemotePath)

    backupSpinner.succeed('备份完成')
    console.log(chalk.cyan('\n备份文件:'))
    console.log(chalk.green(`${backupUrl}`))
    console.log()
  } catch (error) {
    backupSpinner.fail('备份失败')
    throw error
  } finally {
    tempDir.cleanup()
    try {
      if (fs.existsSync(zipFilePath)) {
        fs.rmSync(zipFilePath)
      }
    } catch (error) {
      console.warn(chalk.yellow('⚠ 清理zip文件失败'), error)
    }
  }
}

async function createSingleBackup(
  client: Client,
  dir: string,
  alias: string,
  singleBackFiles: string[],
  showBackFile: boolean = false,
) {
  const timestamp = dayjs().format('YYYYMMDD_HHmmss')
  const backupSpinner = ora(`备份指定文件中 ${chalk.yellow(`==> ${resolveDisplayUrl(alias, dir)}`)}`).start()

  const tempDir = createTempDir('single-backup')
  let backupProgressSpinner: ReturnType<typeof ora> | undefined

  try {
    const remoteFiles = await client.list(dir)
    const normalizedSingleBackFiles = singleBackFiles
      .map((fileName) => normalizeSelectionPath(fileName))
      .filter(Boolean)

    const backupTasks = normalizedSingleBackFiles
      .map((fileName) => {
        const remoteFile = remoteFiles.find((file) => file.name === fileName)
        return remoteFile ? { fileName, exists: true } : { fileName, exists: false }
      })
      .filter((task) => task.exists)

    if (backupTasks.length === 0) {
      backupSpinner.warn('未找到需要备份的文件')
      return
    }

    backupSpinner.stop()

    if (showBackFile) {
      console.log(chalk.cyan(`\n开始单文件备份，共 ${backupTasks.length} 个文件:`))
      backupTasks.forEach((task) => {
        console.log(chalk.gray(`  - ${task.fileName}`))
      })
    }

    backupProgressSpinner = ora('正在备份文件...').start()

    const concurrencyLimit = 3
    let backedUpCount = 0
    const backedUpFiles: string[] = []

    for (let i = 0; i < backupTasks.length; i += concurrencyLimit) {
      const batch = backupTasks.slice(i, i + concurrencyLimit)
      const promises = batch.map(async ({ fileName }) => {
        try {
          const localTempPath = path.join(tempDir.path, fileName)
          const extIndex = fileName.lastIndexOf('.')
          const name = extIndex > -1 ? fileName.slice(0, extIndex) : fileName
          const ext = extIndex > -1 ? fileName.slice(extIndex) : ''
          const backupFileName = `${name}.${timestamp}${ext}`
          const sourceRemotePath = normalizeRemotePath(dir, fileName)
          const backupRemotePath = normalizeRemotePath(dir, backupFileName)

          await client.downloadTo(localTempPath, sourceRemotePath)
          await client.uploadFrom(localTempPath, backupRemotePath)

          backedUpFiles.push(resolveDisplayUrl(alias, backupRemotePath))
          return true
        } catch (error) {
          console.warn(chalk.yellow(`备份文件 ${fileName} 失败:`), error instanceof Error ? error.message : error)
          return false
        }
      })

      const results = await Promise.all(promises)
      backedUpCount += results.filter(Boolean).length
    }

    if (backedUpCount > 0) {
      backupProgressSpinner.succeed('备份完成')
      console.log(chalk.cyan('\n备份文件:'))
      backedUpFiles.forEach((url) => {
        console.log(chalk.green(`🔗  ${url}`))
      })
      console.log()
    } else {
      backupProgressSpinner.fail('所有文件备份失败')
    }
  } catch (error) {
    if (backupProgressSpinner) {
      backupProgressSpinner.fail('备份过程中发生错误')
    } else {
      backupSpinner.fail('备份过程中发生错误')
    }
    throw error
  } finally {
    tempDir.cleanup()
  }
}
