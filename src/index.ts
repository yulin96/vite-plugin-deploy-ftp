import { checkbox, select } from '@inquirer/prompts'
import archiver from 'archiver'
import { Client } from 'basic-ftp'
import chalk from 'chalk'
import dayjs from 'dayjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ora from 'ora'
import { normalizePath, Plugin } from 'vite'

export type vitePluginDeployFtpOption =
  | ({
      uploadPath: string
      singleBackFiles?: string[]
      singleBack?: boolean
      open?: boolean
      maxRetries?: number
      retryDelay?: number
      showBackFile?: boolean
      autoUpload?: boolean
    } & {
      ftps: { name: string; host?: string; port?: number; user?: string; password?: string; alias?: string }[]
      defaultFtp?: string
    })
  | ({
      uploadPath: string
      singleBackFiles?: string[]
      singleBack?: boolean
      open?: boolean
      maxRetries?: number
      retryDelay?: number
      showBackFile?: boolean
      autoUpload?: boolean
    } & { name?: string; host?: string; port?: number; user?: string; password?: string; alias?: string })

interface TempDir {
  path: string
  cleanup: () => void
}

interface FtpConfig {
  name?: string
  host?: string
  port?: number
  user?: string
  password?: string
  alias?: string
}

export default function vitePluginDeployFtp(option: vitePluginDeployFtpOption): Plugin {
  const {
    open = true,
    uploadPath,
    singleBack = false,
    singleBackFiles = ['index.html'],
    showBackFile = false,
    maxRetries = 3,
    retryDelay = 1000,
    autoUpload = false,
  } = option || {}

  // 检查是否为多FTP配置
  const isMultiFtp = 'ftps' in option
  const ftpConfigs: FtpConfig[] =
    isMultiFtp ? option.ftps : [{ ...option, name: option.name || option.alias || option.host }]
  const defaultFtp = isMultiFtp ? option.defaultFtp : undefined

  // 配置验证
  if (!uploadPath || (isMultiFtp && (!option.ftps || option.ftps.length === 0))) {
    return {
      name: 'vite-plugin-deploy-ftp',
      apply: 'build',
      enforce: 'post',
      configResolved() {},
      closeBundle: { sequential: true, order: 'post', async handler() {} },
    }
  }

  let outDir = 'dist'
  let buildFailed = false
  return {
    name: 'vite-plugin-deploy-ftp',
    apply: 'build',
    enforce: 'post',
    buildEnd(error) {
      if (error) buildFailed = true
    },
    configResolved(config) {
      outDir = config.build?.outDir || 'dist'
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        if (!open || buildFailed) return

        try {
          process.stdout.write('\x1b[2J\x1b[0f')
          await deployToFtp()
        } catch (error) {
          console.error(chalk.red('❌ FTP 部署失败:'), error instanceof Error ? error.message : error)
          throw error
        }
      },
    },
  }

  async function deployToFtp() {
    if (!autoUpload) {
      const ftpUploadChoice = await select({
        message: '是否上传FTP',
        choices: ['是', '否'],
        default: '是',
      })
      if (ftpUploadChoice === '否') return
    }

    let selectedConfigs: FtpConfig[] = []

    if (isMultiFtp) {
      // 检查是否有默认FTP配置
      if (defaultFtp) {
        const defaultConfig = ftpConfigs.find((ftp) => ftp.name === defaultFtp)
        if (defaultConfig) {
          if (validateFtpConfig(defaultConfig)) {
            console.log(chalk.blue(`使用默认FTP配置: ${defaultFtp}`))
            selectedConfigs = [defaultConfig]
          } else {
            console.log(chalk.yellow(`⚠️ 默认FTP配置 "${defaultFtp}" 缺少必需参数，将进行手动选择`))
          }
        }
      }

      // 如果没有找到默认配置或没有设置默认配置，则进行手动选择
      if (selectedConfigs.length === 0) {
        // 过滤出有效的配置用于选择
        const validConfigs = ftpConfigs.filter(validateFtpConfig)
        const invalidConfigs = ftpConfigs.filter((config) => !validateFtpConfig(config))

        // 如果有无效配置，显示警告
        if (invalidConfigs.length > 0) {
          console.log(chalk.yellow('\n 以下FTP配置缺少必需参数，已从选择列表中排除:'))
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
          return
        }

        const choices = validConfigs.map((ftp) => ({
          name: ftp.name,
          value: ftp,
        }))

        selectedConfigs = await checkbox({
          message: '选择要上传的FTP服务器（可多选）',
          choices,
          required: true,
        })
      }
    } else {
      // 单个FTP配置，验证并添加默认的name属性
      const singleConfig = ftpConfigs[0] as FtpConfig
      if (validateFtpConfig(singleConfig)) {
        selectedConfigs = [{ ...singleConfig, name: singleConfig.name || singleConfig.host }]
      } else {
        const missing = []
        if (!singleConfig.host) missing.push('host')
        if (!singleConfig.user) missing.push('user')
        if (!singleConfig.password) missing.push('password')
        console.error(chalk.red(`❌ FTP配置缺少必需参数: ${missing.join(', ')}`))
        return
      }
    }

    // 依次上传到选中的FTP服务器
    for (const ftpConfig of selectedConfigs) {
      const { host, port = 21, user, password, alias = '', name } = ftpConfig

      // 验证必需的配置
      if (!host || !user || !password) {
        console.error(chalk.red(`❌ FTP配置 "${name || host || '未知'}" 缺少必需参数:`))
        if (!host) console.error(chalk.red('  - 缺少 host'))
        if (!user) console.error(chalk.red('  - 缺少 user'))
        if (!password) console.error(chalk.red('  - 缺少 password'))
        continue // 跳过这个配置，继续下一个
      }

      const { protocol, baseUrl } = parseAlias(alias)
      const displayName = name || host

      // 获取所有需要上传的文件
      const allFiles = getAllFiles(outDir)
      const totalFiles = allFiles.length

      console.log(chalk.bold(`\n🚀 FTP 部署开始`))
      console.log()
      console.log(`Host:     ${chalk.blue(host)}`)
      console.log(`User:     ${chalk.blue(user)}`)
      console.log(`Source:   ${chalk.blue(outDir)}`)
      console.log(`Target:   ${chalk.blue(uploadPath)}`)
      console.log(`Files:    ${chalk.blue(totalFiles)}`)
      console.log()

      const client = new Client()
      let uploadSpinner: ReturnType<typeof ora> | undefined
      const startTime = Date.now()

      try {
        uploadSpinner = ora(`连接到 ${displayName} 中...`).start()

        await connectWithRetry(client, { host, port, user, password }, maxRetries, retryDelay)

        uploadSpinner.color = 'green'
        uploadSpinner.text = '连接成功'
        // 稍微延迟一下让用户看到连接成功
        await new Promise((resolve) => setTimeout(resolve, 500))

        const fileList = await client.list(uploadPath)
        uploadSpinner.succeed('连接成功!')

        const startDir = await client.pwd()

        if (fileList.length) {
          if (singleBack) {
            await createSingleBackup(client, uploadPath, protocol, baseUrl, singleBackFiles, showBackFile)
          } else {
            const isBackFiles = await select({
              message: `是否备份 ${displayName} 的远程文件`,
              choices: ['否', '是'],
              default: '否',
            })
            if (isBackFiles === '是') {
              await createBackupFile(client, uploadPath, protocol, baseUrl, showBackFile)
            }
          }
        }

        // 开始上传
        const progressSpinner = ora('准备上传...').start()

        let uploadedCount = 0

        // 分组文件以减少目录切换
        const groups: Record<string, string[]> = {}
        for (const file of allFiles) {
          const dir = path.dirname(file)
          if (!groups[dir]) groups[dir] = []
          groups[dir].push(path.basename(file))
        }

        for (const relDir of Object.keys(groups)) {
          await client.cd(startDir) // 确保每次从初始目录开始
          const remoteDir = normalizePath(path.join(uploadPath, relDir))
          await client.ensureDir(remoteDir)

          for (const fileName of groups[relDir]) {
            const currentFile = path.join(relDir, fileName)
            const displayPath = normalizePath(currentFile)
            progressSpinner.text = `正在上传: ${chalk.dim(displayPath)}\n${formatProgressBar(uploadedCount, totalFiles)}`

            const localFile = path.join(outDir, relDir, fileName)
            await client.uploadFrom(localFile, fileName)
            uploadedCount++
          }
        }

        progressSpinner.succeed('所有文件上传完成!')
        console.log(chalk.green(formatProgressBar(totalFiles, totalFiles)))
        process.stdout.write('\x1b[2J\x1b[0f')
        console.log(chalk.gray('\n────────────────────────────────────────\n'))

        const duration = ((Date.now() - startTime) / 1000).toFixed(2)
        console.log(`🎉 部署成功!`)
        console.log()
        console.log(`统计:`)
        console.log(` ✔ 成功: ${chalk.green(totalFiles)}`)
        console.log(` ⏱ 耗时: ${chalk.green(duration + 's')}`)
        console.log()

        if (baseUrl) {
          console.log(`访问地址: ${chalk.green(buildUrl(protocol, baseUrl, uploadPath))}`)
          console.log()
        }
      } catch (error) {
        if (uploadSpinner) {
          uploadSpinner.fail(`❌ 上传到 ${displayName} 失败`)
        }
        console.error(chalk.red(`❌ 上传到 ${displayName} 失败:`), error instanceof Error ? error.message : error)
        throw error
      } finally {
        client.close()
      }
    }
  }
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = [], relativePath = '') {
  const files = fs.readdirSync(dirPath)

  files.forEach(function (file) {
    const fullPath = path.join(dirPath, file)
    const relPath = path.join(relativePath, file)
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles, relPath)
    } else {
      arrayOfFiles.push(relPath)
    }
  })

  return arrayOfFiles
}

function formatProgressBar(current: number, total: number, width = 30) {
  const percentage = Math.round((current / total) * 100)
  const filled = Math.round((width * current) / total)
  const empty = width - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  return `${bar} ${percentage}% (${current}/${total})`
}

// 辅助函数
function validateFtpConfig(
  config: FtpConfig,
): config is Required<Pick<FtpConfig, 'host' | 'user' | 'password'>> & FtpConfig {
  return !!(config.host && config.user && config.password)
}

function parseAlias(alias: string = '') {
  const [protocol = '', baseUrl = ''] = alias.split('://')
  return {
    protocol: protocol ? `${protocol}://` : '',
    baseUrl: baseUrl || '',
  }
}

function buildUrl(protocol: string, baseUrl: string, path: string) {
  return protocol + normalizePath(baseUrl + path)
}

async function connectWithRetry(
  client: Client,
  config: { host: string; port: number; user: string; password: string },
  maxRetries: number,
  retryDelay: number,
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
      return // 成功连接
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxRetries) {
        console.log(chalk.yellow(`⚠️ 连接失败，${retryDelay}ms 后重试 (${attempt}/${maxRetries})`))
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
      }
    }
  }

  throw new Error(`❌ FTP 连接失败，已重试 ${maxRetries} 次: ${lastError?.message}`)
}

function createTempDir(basePath: string): TempDir {
  // 使用系统临时目录，避免在项目目录中创建临时文件
  const tempBaseDir = os.tmpdir()
  const tempPath = path.join(tempBaseDir, 'vite-plugin-deploy-ftp', basePath)

  if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true })
  }

  return {
    path: tempPath,
    cleanup: () => {
      try {
        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { recursive: true, force: true })
        }
      } catch (error) {
        console.warn(chalk.yellow(`⚠️ 清理临时目录失败: ${tempPath}`), error)
      }
    },
  }
}

async function createBackupFile(
  client: Client,
  dir: string,
  protocol: string,
  baseUrl: string,
  showBackFile: boolean = false,
) {
  const backupSpinner = ora(`创建备份文件中 ${chalk.yellow(`==> ${buildUrl(protocol, baseUrl, dir)}`)}`).start()

  const fileName = `backup_${dayjs().format('YYYYMMDD_HHmmss')}.zip`
  const tempDir = createTempDir('backup-zip')
  const zipFilePath = path.join(os.tmpdir(), 'vite-plugin-deploy-ftp', fileName)

  try {
    // 确保zip文件的目录存在
    const zipDir = path.dirname(zipFilePath)
    if (!fs.existsSync(zipDir)) {
      fs.mkdirSync(zipDir, { recursive: true })
    }

    // 获取远程文件列表，过滤掉已有的备份文件
    const remoteFiles = await client.list(dir)
    const filteredFiles = remoteFiles.filter((file) => !file.name.startsWith('backup_') || !file.name.endsWith('.zip'))

    if (showBackFile) {
      console.log(chalk.cyan(`\n开始备份远程文件，共 ${filteredFiles.length} 个文件:`))
      filteredFiles.forEach((file) => {
        console.log(chalk.gray(`  - ${file.name} (${file.size} bytes)`))
      })
    }

    // 逐个下载过滤后的文件，跳过备份文件
    for (const file of filteredFiles) {
      if (file.type === 1) {
        // 只下载普通文件，跳过目录
        await client.downloadTo(path.join(tempDir.path, file.name), normalizePath(`${dir}/${file.name}`))
      }
    }

    backupSpinner.text = `下载远程文件成功 ${chalk.yellow(`==> ${buildUrl(protocol, baseUrl, dir)}`)}`

    // 创建压缩文件
    await createZipFile(tempDir.path, zipFilePath)

    backupSpinner.text = `压缩完成, 准备上传 ${chalk.yellow(
      `==> ${buildUrl(protocol, baseUrl, dir + '/' + fileName)}`,
    )}`

    await client.uploadFrom(zipFilePath, normalizePath(`${dir}/${fileName}`))

    // 生成备份后的完整URL
    const backupUrl = buildUrl(protocol, baseUrl, `${dir}/${fileName}`)

    backupSpinner.succeed('备份完成')

    // 输出备份文件的完整路径
    console.log(chalk.cyan('\n备份文件:'))
    console.log(chalk.green(`${backupUrl}`))
    console.log() // 添加空行分隔
  } catch (error) {
    backupSpinner.fail('备份失败')
    throw error
  } finally {
    tempDir.cleanup()
    // 清理zip文件
    try {
      if (fs.existsSync(zipFilePath)) {
        fs.rmSync(zipFilePath)
      }
    } catch (error) {
      console.warn(chalk.yellow('⚠️ 清理zip文件失败'), error)
    }
  }
}

async function createZipFile(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = archiver('zip', {
      zlib: { level: 9 },
    })

    output.on('close', () => {
      resolve()
    })

    archive.on('error', (err) => {
      reject(err)
    })

    archive.pipe(output)
    archive.directory(sourceDir, false)
    archive.finalize()
  })
}

async function createSingleBackup(
  client: Client,
  dir: string,
  protocol: string,
  baseUrl: string,
  singleBackFiles: string[],
  showBackFile: boolean = false,
) {
  const timestamp = dayjs().format('YYYYMMDD_HHmmss')
  const backupSpinner = ora(`备份指定文件中 ${chalk.yellow(`==> ${buildUrl(protocol, baseUrl, dir)}`)}`).start()

  const tempDir = createTempDir('single-backup')
  let backupProgressSpinner: ReturnType<typeof ora> | undefined

  try {
    // 获取远程目录下的文件列表
    const remoteFiles = await client.list(dir)
    const backupTasks = singleBackFiles
      .map((fileName) => {
        const remoteFile = remoteFiles.find((f) => f.name === fileName)
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

    // 创建新的备份进度spinner
    backupProgressSpinner = ora('正在备份文件...').start()

    // 并发备份文件（限制并发数避免过载）
    const concurrencyLimit = 3
    let backedUpCount = 0
    const backedUpFiles: string[] = []

    for (let i = 0; i < backupTasks.length; i += concurrencyLimit) {
      const batch = backupTasks.slice(i, i + concurrencyLimit)
      const promises = batch.map(async ({ fileName }) => {
        try {
          const localTempPath = path.join(tempDir.path, fileName)
          const [name, ext] = fileName.split('.')
          const suffix = ext ? `.${ext}` : ''
          const backupFileName = `${name}.${timestamp}${suffix}`
          const backupRemotePath = normalizePath(`${dir}/${backupFileName}`)

          // 下载远程文件到本地临时目录
          await client.downloadTo(localTempPath, normalizePath(`${dir}/${fileName}`))
          // 上传为带时间戳的新文件名
          await client.uploadFrom(localTempPath, backupRemotePath)

          // 生成备份后的完整URL
          const backupUrl = buildUrl(protocol, baseUrl, backupRemotePath)
          backedUpFiles.push(backupUrl)

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

      // 输出备份后的完整路径
      console.log(chalk.cyan('\n备份文件:'))
      backedUpFiles.forEach((url) => {
        console.log(chalk.green(`🔗  ${url}`))
      })
      console.log() // 添加空行分隔
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
