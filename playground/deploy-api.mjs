import { deployFtp } from '../dist/deploy.js'

await deployFtp({
  host: process.env.zH5FtpHost || '',
  port: +(process.env.zH5FtpPort || 21),
  user: process.env.zH5FtpUser || '',
  password: process.env.zH5FtpPassword || '',
  alias: process.env.zH5FtpAlias || '',

  outDir: 'playground/__dist__',
  uploadPath: '/__test/vite-plugin-deploy-ftp/__direct-api__/',
  autoUpload: true,
  singleBack: true,
})
