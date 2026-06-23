import chalk from 'chalk'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yazl from 'yazl'
import type { TempDir } from '../types'
import { normalizeSlash } from './path'

export function getAllFiles(dirPath: string, arrayOfFiles: string[] = [], relativePath = '') {
  const files = fs.readdirSync(dirPath)

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file)
    const relPath = path.join(relativePath, file)
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles, relPath)
    } else {
      arrayOfFiles.push(normalizeSlash(relPath))
    }
  })

  return arrayOfFiles
}

export function createTempDir(basePath: string): TempDir {
  const tempBaseDir = os.tmpdir()
  const tempParentDir = path.join(tempBaseDir, 'vite-plugin-deploy-ftp')
  const safeBasePath = basePath.replace(/[\\/]+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '-') || 'temp'

  if (!fs.existsSync(tempParentDir)) {
    fs.mkdirSync(tempParentDir, { recursive: true })
  }

  const tempPath = fs.mkdtempSync(path.join(tempParentDir, `${safeBasePath}-`))

  return {
    path: tempPath,
    cleanup: () => {
      try {
        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { recursive: true, force: true })
        }
      } catch (error) {
        console.warn(chalk.yellow(`⚠ 清理临时目录失败: ${tempPath}`), error)
      }
    },
  }
}

export async function createZipFile(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const zipFile = new yazl.ZipFile()

    const handleError = (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    output.on('close', resolve)
    output.on('error', handleError)
    zipFile.outputStream.on('error', handleError)

    zipFile.outputStream.pipe(output)

    for (const relativePath of getAllFiles(sourceDir)) {
      const filePath = path.join(sourceDir, relativePath)
      zipFile.addFile(filePath, normalizeSlash(relativePath))
    }

    zipFile.end()
  })
}
