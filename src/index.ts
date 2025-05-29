import { select } from '@inquirer/prompts'
import archiver from 'archiver'
import { Client } from 'basic-ftp'
import chalk from 'chalk'
import dayjs from 'dayjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ora from 'ora'
import { normalizePath, Plugin } from 'vite'

export type vitePluginDeployFtpOption = {
  host: string
  port?: number
  user: string
  password: string
  uploadPath: string

  singleBackFiles?: string[]
  singleBack?: boolean

  alias?: string
  open?: boolean
  maxRetries?: number
  retryDelay?: number
}

interface TempDir {
  path: string
  cleanup: () => void
}

export default function vitePluginDeployFtp(option: vitePluginDeployFtpOption): Plugin {
  const {
    open = true,
    host,
    port = 21,
    user,
    password,
    uploadPath,
    alias = '',
    singleBack = false,
    singleBackFiles = ['index.html'],
    maxRetries = 3,
    retryDelay = 1000,
  } = option || {}

  // 配置验证
  if (!host || !user || !password || !uploadPath) {
    return {
      name: 'vite-plugin-deploy-ftp',
      apply: 'build',
      enforce: 'post',
      configResolved() {},
      closeBundle: { sequential: true, order: 'post', async handler() {} },
    }
  }

  let outDir = 'dist'
  return {
    name: 'vite-plugin-deploy-ftp',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = config.build?.outDir || 'dist'
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        if (!open) return

        try {
          await deployToFtp()
        } catch (error) {
          console.error(chalk.red('FTP 部署失败:'), error instanceof Error ? error.message : error)
          throw error
        }
      },
    },
  }

  async function deployToFtp() {
    const { protocol, baseUrl } = parseAlias(alias)

    const ftpUploadChoice = await select({
      message: '是否上传FTP',
      choices: ['是', '否'],
      default: '是',
    })
    if (ftpUploadChoice === '否') return

    const client = new Client()
    let uploadSpinner: ReturnType<typeof ora> | undefined

    try {
      uploadSpinner = ora('准备自动上传，创建连接中...').start()

      await connectWithRetry(client, { host, port, user, password }, maxRetries, retryDelay)

      uploadSpinner.color = 'blue'
      uploadSpinner.text = '连接成功'

      const fileList = await client.list(uploadPath)
      uploadSpinner.succeed(`已连接 ${chalk.green(`目录: ==> ${buildUrl(protocol, baseUrl, uploadPath)}`)}`)

      if (fileList.length) {
        if (singleBack) {
          await createSingleBackup(client, uploadPath, protocol, baseUrl, singleBackFiles)
        } else {
          const isBackFiles = await select({
            message: '是否备份远程文件',
            choices: ['否', '是'],
            default: '否',
          })
          if (isBackFiles === '是') {
            await createBackupFile(client, uploadPath, protocol, baseUrl)
          }
        }
      }

      const uploadFileSpinner = ora('上传中...').start()
      await client.uploadFromDir(outDir, uploadPath)
      uploadFileSpinner.succeed('上传成功 url:' + chalk.green(buildUrl(protocol, baseUrl, uploadPath)))
    } finally {
      client.close()
    }
  }
}

// 辅助函数
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
  retryDelay: number
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
        console.log(chalk.yellow(`连接失败，${retryDelay}ms 后重试 (${attempt}/${maxRetries})`))
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
      }
    }
  }

  throw new Error(`FTP 连接失败，已重试 ${maxRetries} 次: ${lastError?.message}`)
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
        console.warn(chalk.yellow(`清理临时目录失败: ${tempPath}`), error)
      }
    },
  }
}

async function createBackupFile(client: Client, dir: string, protocol: string, baseUrl: string) {
  const backupSpinner = ora(`创建备份文件中 ${chalk.yellow(`目录: ==> ${buildUrl(protocol, baseUrl, dir)}`)}`).start()

  const fileName = `backup_${dayjs().format('YYYYMMDD_HHmmss')}.zip`
  const tempDir = createTempDir('backup-zip')
  const zipFilePath = path.join(os.tmpdir(), 'vite-plugin-deploy-ftp', fileName)

  try {
    // 确保zip文件的目录存在
    const zipDir = path.dirname(zipFilePath)
    if (!fs.existsSync(zipDir)) {
      fs.mkdirSync(zipDir, { recursive: true })
    }

    await client.downloadToDir(tempDir.path, dir)
    backupSpinner.text = `下载远程文件成功 ${chalk.yellow(`目录: ==> ${buildUrl(protocol, baseUrl, dir)}`)}`

    // 清理旧的备份文件
    fs.readdirSync(tempDir.path).forEach((fileName) => {
      if (fileName.startsWith('backup_') && fileName.endsWith('.zip')) {
        fs.rmSync(path.join(tempDir.path, fileName))
      }
    })

    // 创建压缩文件
    await createZipFile(tempDir.path, zipFilePath)

    backupSpinner.text = `压缩完成, 准备上传 ${chalk.yellow(
      `目录: ==> ${buildUrl(protocol, baseUrl, dir + '/' + fileName)}`
    )}`

    await client.uploadFrom(zipFilePath, normalizePath(`${dir}/${fileName}`))
    backupSpinner.succeed(`备份成功 ${chalk.green(`目录: ==> ${buildUrl(protocol, baseUrl, dir + '/' + fileName)}`)}`)
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
      console.warn(chalk.yellow('清理zip文件失败'), error)
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
  singleBackFiles: string[]
) {
  const timestamp = dayjs().format('YYYYMMDD_HHmmss')
  const backupSpinner = ora(`备份指定文件中 ${chalk.yellow(`目录: ==> ${buildUrl(protocol, baseUrl, dir)}`)}`).start()

  const tempDir = createTempDir('single-backup')

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

    // 并发备份文件（限制并发数避免过载）
    const concurrencyLimit = 3
    let backedUpCount = 0

    for (let i = 0; i < backupTasks.length; i += concurrencyLimit) {
      const batch = backupTasks.slice(i, i + concurrencyLimit)
      const promises = batch.map(async ({ fileName }) => {
        try {
          const localTempPath = path.join(tempDir.path, fileName)
          const [name, ext] = fileName.split('.')
          const suffix = ext ? `.${ext}` : ''
          const backupRemotePath = normalizePath(`${dir}/${name}.${timestamp}${suffix}`)

          // 下载远程文件到本地临时目录
          await client.downloadTo(localTempPath, normalizePath(`${dir}/${fileName}`))
          // 上传为带时间戳的新文件名
          await client.uploadFrom(localTempPath, backupRemotePath)
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
      backupSpinner.succeed(`已备份 ${backedUpCount} 个文件到 ${chalk.green(buildUrl(protocol, baseUrl, dir))}`)
    } else {
      backupSpinner.fail('所有文件备份失败')
    }
  } catch (error) {
    backupSpinner.fail('备份过程中发生错误')
    throw error
  } finally {
    tempDir.cleanup()
  }
}
