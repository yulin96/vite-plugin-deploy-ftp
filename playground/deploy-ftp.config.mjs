import { defineDeployConfig } from '../dist/index.js'

export default defineDeployConfig({
  host: process.env.zH5FtpHost || '',
  port: +(process.env.zH5FtpPort || 21),
  user: process.env.zH5FtpUser || '',
  password: process.env.zH5FtpPassword || '',
  alias: process.env.zH5FtpAlias || '',

  outDir: 'playground/__dist__',
  uploadPath: '/__test/vite-plugin-deploy-ftp/__direct-cli__/',
  skip: ['**/*.html'],
  autoUpload: true,
  singleBack: true,
  autoDelete: false,
  manifest: true,
  configBase: `${process.env.zH5FtpAlias || ''}/__test/vite-plugin-deploy-ftp/__direct-cli__/`,
})
