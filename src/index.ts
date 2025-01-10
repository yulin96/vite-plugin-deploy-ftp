import { select } from '@inquirer/prompts'
import archiver from 'archiver'
import { Client } from 'basic-ftp'
import chalk from 'chalk'
import dayjs from 'dayjs'
import fs from 'node:fs'
import path from 'node:path'
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
          secureOptions: { rejectUnauthorized: false, timeout: 60000 },
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

  const localDir = `./__temp/zip`
  const zipFilePath = `./__temp/${fileName}`

  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true })
  }
  await client.downloadToDir(localDir, dir)
  backupSpinner.text = `下载远程文件成功 ${chalk.yellow(
    `目录: ==> ${protocol + normalizePath(other + dir)}`
  )}`

  fs.readdirSync(localDir).forEach((i) => {
    if (i.startsWith('backup_') && i.endsWith('.zip')) {
      fs.rmSync(path.join(localDir, i))
    }
  })

  const output = fs.createWriteStream(zipFilePath)
  const archive = archiver('zip', {
    zlib: { level: 9 },
  })

  output.on('close', function () {
    // console.log(`压缩文件已创建，总共压缩了 ${archive.pointer()} 字节.`)
  })

  archive.on('error', function (err) {
    backupSpinner.fail('压缩失败')
    throw err
  })

  archive.pipe(output)
  archive.directory(localDir, false)
  await archive.finalize()
  backupSpinner.text = `压缩完成, 准备上传 ${chalk.yellow(
    `目录: ==> ${protocol + normalizePath(other + dir + '/' + fileName)}`
  )}`

  await client.uploadFrom(zipFilePath, normalizePath(`${dir}/${fileName}`))
  backupSpinner.succeed(
    `备份成功 ${chalk.green(`目录: ==> ${protocol + normalizePath(other + dir + '/' + fileName)}`)}`
  )

  fs.rmSync(`./__temp`, { recursive: true })
}
