# vite-plugin-deploy-ftp

将 dist 目录上传到 FTP 服务器

## 介绍

`vite-plugin-deploy-ftp` 是一个 Vite 插件，用于将打包后的文件上传到 FTP 服务器。

## 安装

```bash
pnpm add vite-plugin-deploy-ftp -D
```

## 使用

```ts
// vite.config.ts
import vitePluginDeployFtp from 'vite-plugin-deploy-ftp'

// ...existing code...
export default {
  // ...existing code...
  plugins: [
    // 在最后一个插件中使用
    vitePluginDeployFtp({
      open: true,
      host: process.env.zH5FtpHost as string,
      port: +(process.env.zH5FtpPort || 21),
      user: process.env.zH5FtpUser as string,
      password: process.env.zH5FtpPassword as string,
      uploadPath: `${env.VITE_FTP_DIRNAME}`,
      alias: `https://h5.eventnet.cn/`,
    }),
  ],
}
```
