import { defineConfig } from 'vite'
import vitePluginDeployFtp from './src'

export default defineConfig({
  plugins: [
    vitePluginDeployFtp({
      open: true,
      uploadPath: '__test/vite-plugin-deploy-ftp/',
      singleBack: true,
      defaultFtp: process.env.zH5FtpName,
      autoUpload: true,
      ftps: [
        {
          name: process.env.zH5FtpName || process.env.zH5FtpAlias || '',
          host: process.env.zH5FtpHost,
          port: +(process.env.zH5FtpPort || 21),
          user: process.env.zH5FtpUser,
          password: process.env.zH5FtpPassword,
          alias: process.env.zH5FtpAlias,
        },
        {
          name: process.env.zH5FtpName2 || process.env.zH5FtpAlias2 || '',
          host: process.env.zH5FtpHost2,
          port: +(process.env.zH5FtpPort2 || 21),
          user: process.env.zH5FtpUser2,
          password: process.env.zH5FtpPassword2,
          alias: process.env.zH5FtpAlias2,
        },
        {
          name: process.env.zQRFtpName || process.env.zQRFtpAlias || '',
          host: process.env.zQRFtpHost,
          port: +(process.env.zQRFtpPort || 21),
          user: process.env.zQRFtpUser,
          password: process.env.zQRFtpPassword,
          alias: process.env.zQRFtpAlias,
        },
      ],
    }),
  ],
  build: {
    outDir: 'dist_test',
  },
})
