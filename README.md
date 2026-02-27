# vite-plugin-deploy-ftp

将 dist 目录上传到 FTP 服务器，支持单个或多个 FTP 服务器配置

## 介绍

`vite-plugin-deploy-ftp` 是一个 Vite 插件，用于将打包后的文件上传到 FTP 服务器。插件支持：

- 单个 FTP 服务器配置
- 多个 FTP 服务器配置（可多选上传目标）
- 自动备份远程文件
- 连接重试机制
- 选择性文件备份
- 当前版本仅支持 ESM（`import`），不再提供 CommonJS（`require`）入口

## 安装

```bash
pnpm add vite-plugin-deploy-ftp -D
```

## 使用

### 单个 FTP 配置

```ts
// vite.config.ts
import vitePluginDeployFtp from 'vite-plugin-deploy-ftp'

export default {
  plugins: [
    vitePluginDeployFtp({
      open: true,
      host: 'ftp.example.com',
      port: 21,
      user: 'username',
      password: 'password',
      uploadPath: '/public_html',
      alias: 'https://example.com',
      singleBack: false,
      singleBackFiles: ['index.html'],
      maxRetries: 3,
      retryDelay: 1000,
    }),
  ],
}
```

### 多个 FTP 配置

```ts
// vite.config.ts
import vitePluginDeployFtp from 'vite-plugin-deploy-ftp'

export default {
  plugins: [
    vitePluginDeployFtp({
      open: true,
      uploadPath: '/public_html',
      singleBack: false,
      singleBackFiles: ['index.html'],
      maxRetries: 3,
      retryDelay: 1000,
      ftps: [
        {
          name: '生产环境',
          host: 'ftp.production.com',
          port: 21,
          user: 'prod_user',
          password: 'prod_password',
          alias: 'https://production.com',
        },
        {
          name: '测试环境',
          host: 'ftp.test.com',
          port: 21,
          user: 'test_user',
          password: 'test_password',
          alias: 'https://test.com',
        },
        {
          name: '开发环境',
          host: 'ftp.dev.com',
          port: 21,
          user: 'dev_user',
          password: 'dev_password',
          alias: 'https://dev.com',
        },
      ],
    }),
  ],
}
```

## 配置参数

### 通用参数

| 参数              | 类型       | 默认值           | 说明                             |
| ----------------- | ---------- | ---------------- | -------------------------------- |
| `open`            | `boolean`  | `true`           | 是否启用插件                     |
| `uploadPath`      | `string`   | -                | FTP 服务器上的上传路径           |
| `singleBack`      | `boolean`  | `false`          | 是否使用单文件备份模式           |
| `singleBackFiles` | `string[]` | `['index.html']` | 单文件备份模式下要备份的文件列表 |
| `maxRetries`      | `number`   | `3`              | 连接失败时的最大重试次数         |
| `retryDelay`      | `number`   | `1000`           | 重试延迟时间（毫秒）             |

### 单个 FTP 配置参数

| 参数       | 类型     | 默认值 | 说明                       |
| ---------- | -------- | ------ | -------------------------- |
| `host`     | `string` | -      | FTP 服务器地址             |
| `port`     | `number` | `21`   | FTP 服务器端口             |
| `user`     | `string` | -      | FTP 用户名                 |
| `password` | `string` | -      | FTP 密码                   |
| `alias`    | `string` | `''`   | 网站别名，用于生成完整 URL |

### 多个 FTP 配置参数

| 参数   | 类型          | 说明               |
| ------ | ------------- | ------------------ |
| `ftps` | `FtpConfig[]` | FTP 服务器配置数组 |

#### FtpConfig 对象

| 参数       | 类型     | 默认值 | 说明                               |
| ---------- | -------- | ------ | ---------------------------------- |
| `name`     | `string` | -      | FTP 服务器名称（用于选择界面显示） |
| `host`     | `string` | -      | FTP 服务器地址                     |
| `port`     | `number` | `21`   | FTP 服务器端口                     |
| `user`     | `string` | -      | FTP 用户名                         |
| `password` | `string` | -      | FTP 密码                           |
| `alias`    | `string` | `''`   | 网站别名，用于生成完整 URL         |

## 功能特性

### 多服务器选择

当使用多个 FTP 配置时，插件会显示一个多选界面，让您选择要上传到哪些服务器：

```
? 选择要上传的FTP服务器（可多选）
❯ ◯ 生产环境
  ◯ 测试环境
  ◯ 开发环境
```

### 备份功能

插件提供两种备份模式：

1. **完整备份**: 将远程目录下的所有文件打包备份
2. **选择性备份**: 只备份指定的文件（通过 `singleBackFiles` 配置）

### 连接重试

当 FTP 连接失败时，插件会自动重试，您可以通过 `maxRetries` 和 `retryDelay` 参数控制重试行为。

## 环境变量示例

建议将敏感信息（如用户名和密码）放在环境变量中：

```bash
# .env
VITE_FTP_HOST=ftp.example.com
VITE_FTP_PORT=21
VITE_FTP_USER=username
VITE_FTP_PASSWORD=password
VITE_FTP_PATH=/public_html
VITE_FTP_ALIAS=https://example.com
```

```ts
// vite.config.ts
export default {
  plugins: [
    vitePluginDeployFtp({
      host: process.env.VITE_FTP_HOST,
      port: +(process.env.VITE_FTP_PORT || 21),
      user: process.env.VITE_FTP_USER,
      password: process.env.VITE_FTP_PASSWORD,
      uploadPath: process.env.VITE_FTP_PATH,
      alias: process.env.VITE_FTP_ALIAS,
    }),
  ],
}
```
