import { select } from '@inquirer/prompts'
import archiver from 'archiver'
import { Client } from 'basic-ftp'
import chalk from 'chalk'
import dayjs from 'dayjs'
import fs from 'node:fs'
import ora from 'ora'
import { normalizePath, Plugin } from 'vite'

export type vitePluginDeployFtpOption = {
  host: string
  port?: number
  user: string
  password: string
  uploadPath: string

  alias?: string
  open?: boolean
}

export default function vitePluginDeployFtp(option: vitePluginDeployFtpOption): Plugin {
  const { open = true, host, port = 21, user, password, uploadPath, alias = '' } = option || {}

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
        if (!host || !port || !user || !password || !uploadPath || !open) {
          console.log(chalk.yellow('请配置正确的FTP信息'))

          return
        }

        let [protocol, other] = (alias || '://').split('://')

        if (protocol) {
          protocol = protocol + '://'
        }

        const ftpUploadChoice = await select({
          message: '是否上传FTP',
          choices: ['是', '否'],
          default: '是',
        })
        if (ftpUploadChoice === '否') return
        const uploadSpinner = ora('准备自动上传，创建连接中...').start()
        const client = new Client()
        client.ftp.verbose = false
        await client.access({
          host,
          port,
          user,
          password,
          secure: true,
          secureOptions: { rejectUnauthorized: false, timeout: 120000 },
        })
        uploadSpinner.color = 'blue'
        uploadSpinner.text = '连接成功'
        const fileList = await client.list(uploadPath)
        uploadSpinner.succeed(
          `已连接 ${chalk.green(`目录: ==> ${protocol + normalizePath(other + uploadPath)}`)}`
        )
        if (fileList.length) {
          await createBackupFile(client, uploadPath, protocol, other)
        }
        const uploadFileSpinner = ora('上传中...').start()
        await client.uploadFromDir(outDir, uploadPath)
        uploadFileSpinner.succeed(
          '上传成功 url:' + chalk.green(`${protocol + normalizePath(other + uploadPath)}`)
        )
        client.close()
      },
    },
  }
}

async function createBackupFile(client: Client, dir: string, protocol: string, other: string) {
  const backupSpinner = ora(
    `创建备份文件中 ${chalk.yellow(`目录: ==> ${protocol + normalizePath(other + dir)}`)}`
  ).start()

  const fileName = `backup_${dayjs().format('YYYYMMDD_HHmmss')}.zip`

  const output = fs.createWriteStream(fileName)
  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.pipe(output)

  archive.on('error', function (err) {
    backupSpinner.fail('压缩失败')
  })

  archive.on('end', function (err) {
    backupSpinner.succeed(
      `备份成功 ${chalk.green(
        `目录: ==> ${protocol + normalizePath(other + dir + '/' + fileName)}`
      )}`
    )
  })

  try {
    const files = await client.list(dir)
    for (const file of files) {
      if (file.name.startsWith('backup_') && file.name.endsWith('.zip')) {
        await client.remove(file.name)
      } else {
        const fileStream = fs.createWriteStream(file.name)
        await client.downloadTo(fileStream, file.name)
        archive.append(fs.createReadStream(file.name), { name: file.name })
      }
    }
    await archive.finalize()
  } catch (error) {
    backupSpinner.fail('备份失败')
  }
}
