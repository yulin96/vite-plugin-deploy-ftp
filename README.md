# vite-plugin-deploy-ftp

把 Vite 打包后的目录上传到 FTP，适合不想手动打开 FTP 工具、重复拖文件发布的项目。

## 安装

```bash
pnpm add vite-plugin-deploy-ftp -D
```

## 快速开始

推荐用环境变量控制是否上传，默认本地普通打包不上传，只有明确开启时才发布。

```bash
# .env
FTP_HOST=ftp.example.com
FTP_PORT=21
FTP_USER=username
FTP_PASSWORD=password
FTP_PATH=/public_html
FTP_ALIAS=https://example.com
DEPLOY_FTP=0
```

```ts
// vite.config.ts
import { defineConfig, loadEnv } from 'vite'
import vitePluginDeployFtp from 'vite-plugin-deploy-ftp'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const shouldDeploy = env.DEPLOY_FTP === '1'

  return {
    plugins: [
      vitePluginDeployFtp({
        open: shouldDeploy,
        autoUpload: true,
        failOnError: true,
        host: env.FTP_HOST,
        port: +(env.FTP_PORT || 21),
        user: env.FTP_USER,
        password: env.FTP_PASSWORD,
        uploadPath: env.FTP_PATH?.split(',').map((path) => path.trim()) || '',
        alias: env.FTP_ALIAS,
        singleBack: true,
        singleBackFiles: ['index.html'],
      }),
    ],
  }
})
```

上传时再打开开关：

```bash
# macOS / Linux
DEPLOY_FTP=1 pnpm build

# Windows PowerShell
$env:DEPLOY_FTP='1'; pnpm build
```

`FTP_PATH` 可以写一个目录：

```bash
FTP_PATH=/public_html
```

也可以写多个目录：

```bash
FTP_PATH=/public_html,/backup_html
```

## 常用配置说明

| 参数              | 说明                                                           |
| ----------------- | -------------------------------------------------------------- |
| `open`            | 是否启用上传。推荐用环境变量控制，避免普通打包时误上传。       |
| `autoUpload`      | 是否跳过“是否上传”的确认。自动发布时建议设为 `true`。          |
| `failOnError`     | 上传失败时是否让命令失败。发布流程里建议设为 `true`。          |
| `uploadPath`      | 上传目录。支持字符串，也支持字符串数组，数组会上传到多个目录。 |
| `alias`           | 访问域名。填写后，上传完成会输出可访问链接。                   |
| `singleBack`      | 是否只备份指定文件。通常备份 `index.html` 就够，速度更快。     |
| `singleBackFiles` | 单文件备份列表，支持子目录文件，例如 `assets/app.js`。         |
| `ftps`            | 多个 FTP 服务器配置。需要发布到多个服务器时使用。              |
| `defaultFtp`      | 多 FTP 时默认选中的服务器名称，可减少手动选择。                |
| `concurrency`     | 同时上传的数量。服务器不稳定时保持默认值更稳。                 |

## 重要行为说明

- 插件只在 Vite 构建结束后上传。
- `open: false` 时不会上传，也不会检查 FTP 配置。
- `uploadPath` 传数组时，会把同一份文件依次上传到每个目录。
- 多 FTP 和多目录可以一起使用，会按“服务器 × 目录”的组合逐个上传。
- 上传前如果远端目录已有文件，会根据配置询问或执行备份。
- `singleBack: true` 时，只备份 `singleBackFiles` 里的文件。
- `autoUpload: false` 时，上传前会询问是否继续。
- 上传失败且 `failOnError: true` 时，构建命令会失败，方便发布系统拦截。
- 当前版本仅支持 ESM，也就是 `import`，不支持 `require`。

## 风险提示

- 不建议把 FTP 用户名、密码直接写进 `vite.config.ts`，推荐放到环境变量里。
- 生产发布建议使用 `open` 环境变量开关，避免普通打包误传线上目录。
- `uploadPath` 写成数组时，会上传到多个目录，请确认每个目录都是预期目标。
- 完整备份会下载远端目录并重新上传压缩包，远端文件多时会比较慢。
- 如果 FTP 服务器不稳定，不建议把 `concurrency` 调太高。

## 示例

### 多个 FTP 服务器

```ts
import vitePluginDeployFtp from 'vite-plugin-deploy-ftp'

export default {
  plugins: [
    vitePluginDeployFtp({
      open: process.env.DEPLOY_FTP === '1',
      autoUpload: true,
      uploadPath: '/public_html',
      defaultFtp: 'production',
      ftps: [
        {
          name: 'production',
          host: process.env.FTP_PROD_HOST,
          port: 21,
          user: process.env.FTP_PROD_USER,
          password: process.env.FTP_PROD_PASSWORD,
          alias: 'https://example.com',
        },
        {
          name: 'test',
          host: process.env.FTP_TEST_HOST,
          port: 21,
          user: process.env.FTP_TEST_USER,
          password: process.env.FTP_TEST_PASSWORD,
          alias: 'https://test.example.com',
        },
      ],
    }),
  ],
}
```

### 多个上传目录

```ts
import vitePluginDeployFtp from 'vite-plugin-deploy-ftp'

export default {
  plugins: [
    vitePluginDeployFtp({
      open: process.env.DEPLOY_FTP === '1',
      autoUpload: true,
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      uploadPath: ['/public_html', '/backup_html'],
      alias: 'https://example.com',
    }),
  ],
}
```

## 完整配置表

### 通用参数

| 参数              | 类型                 | 默认值           | 说明                                             |
| ----------------- | -------------------- | ---------------- | ------------------------------------------------ |
| `open`            | `boolean`            | `true`           | 是否启用插件                                     |
| `uploadPath`      | `string \| string[]` | -                | FTP 服务器上的上传路径，传数组时会上传到多个目录 |
| `singleBack`      | `boolean`            | `false`          | 是否使用单文件备份模式                           |
| `singleBackFiles` | `string[]`           | `['index.html']` | 单文件备份模式下要备份的文件列表                 |
| `debug`           | `boolean`            | `false`          | 是否输出调试耗时                                 |
| `maxRetries`      | `number`             | `3`              | 连接或上传失败时的最大重试次数                   |
| `retryDelay`      | `number`             | `1000`           | 重试延迟时间，单位毫秒                           |
| `showBackFile`    | `boolean`            | `false`          | 是否显示备份文件列表                             |
| `autoUpload`      | `boolean`            | `false`          | 是否跳过上传确认                                 |
| `fancy`           | `boolean`            | `true`           | 是否使用更丰富的终端输出                         |
| `failOnError`     | `boolean`            | `true`           | 上传失败时是否中断构建命令                       |
| `concurrency`     | `number`             | `1`              | 同时上传的任务数量                               |

### 单个 FTP 配置参数

| 参数       | 类型     | 默认值 | 说明                       |
| ---------- | -------- | ------ | -------------------------- |
| `name`     | `string` | -      | FTP 配置名称               |
| `host`     | `string` | -      | FTP 服务器地址             |
| `port`     | `number` | `21`   | FTP 服务器端口             |
| `user`     | `string` | -      | FTP 用户名                 |
| `password` | `string` | -      | FTP 密码                   |
| `alias`    | `string` | `''`   | 网站别名，用于生成完整 URL |

### 多个 FTP 配置参数

| 参数         | 类型          | 说明                    |
| ------------ | ------------- | ----------------------- |
| `ftps`       | `FtpConfig[]` | FTP 服务器配置数组      |
| `defaultFtp` | `string`      | 默认使用的 FTP 配置名称 |

### FtpConfig 对象

| 参数       | 类型     | 默认值 | 说明                               |
| ---------- | -------- | ------ | ---------------------------------- |
| `name`     | `string` | -      | FTP 服务器名称（用于选择界面显示） |
| `host`     | `string` | -      | FTP 服务器地址                     |
| `port`     | `number` | `21`   | FTP 服务器端口                     |
| `user`     | `string` | -      | FTP 用户名                         |
| `password` | `string` | -      | FTP 密码                           |
| `alias`    | `string` | `''`   | 网站别名，用于生成完整 URL         |
