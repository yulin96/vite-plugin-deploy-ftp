//@ts-check
import archiver from 'archiver'
import { Client } from 'basic-ftp'
import chalk from 'chalk'
import dayjs from 'dayjs'
import fs from 'node:fs'
import { join } from 'node:path'
import ora from 'ora'
import { normalizePath } from 'vite'

async function main() {
  const client = new Client()
  client.ftp.verbose = false

  await client.access({
    host: process.env.zH5FtpHost,
    port: +(process.env.zH5FtpPort || 21),
    user: process.env.zH5FtpUser,
    password: process.env.zH5FtpPassword,
    secure: true,
    secureOptions: { rejectUnauthorized: false, timeout: 120000 },
  })

  await createBackupFile(client, '/test123/', '123', '66')
  console.log('done')
}

main()

async function createBackupFile(client, dir, protocol, other) {
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
    await processDirectory(client, dir, archive)
    // const files = await client.list(dir)
    // for (const file of files) {
    //   const dirName = dir + file.name
    //   console.log(dirName)

    //   if (file.name.startsWith('backup_') && file.name.endsWith('.zip')) {
    //     await client.remove(dirName)
    //   } else {
    //     const fileStream = fs.createWriteStream(dirName)
    //     await client.downloadTo(fileStream, normalizePath(dirName))

    //     archive.append(fs.createReadStream(dirName), { name: dirName })
    //   }
    // }
    await archive.finalize()
  } catch (error) {
    console.log(error)

    backupSpinner.fail('备份失败')
  }
}

async function processDirectory(client, dirPath, archive) {
  const files = await client.list(dirPath)

  for (const file of files) {
    const localFilePath = join(dirPath, file.name)
    if (file.name.startsWith('backup_') && file.name.endsWith('.zip')) {
      await client.remove(localFilePath)
    } else if (file.isDirectory) {
      await processDirectory(client, localFilePath, archive)
    } else {
      const fileStream = fs.createWriteStream(file.name)
      await client.downloadTo(fileStream, localFilePath)
      archive.append(fs.createReadStream(file.name), { name: localFilePath })
    }
  }
}
