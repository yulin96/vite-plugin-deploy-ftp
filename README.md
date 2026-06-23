# vite-plugin-deploy-ftp

Uploads the directory bundled by Vite to an FTP server. It is ideal for projects where you don't want to open FTP tools manually and repeatedly drag files to publish.

[![npm version](https://img.shields.io/npm/v/vite-plugin-deploy-ftp.svg)](https://www.npmjs.com/package/vite-plugin-deploy-ftp)
[![npm downloads](https://img.shields.io/npm/dm/vite-plugin-deploy-ftp.svg)](https://www.npmjs.com/package/vite-plugin-deploy-ftp)
[![License](https://img.shields.io/npm/l/vite-plugin-deploy-ftp.svg)](https://github.com/yulin96/vite-plugin-deploy-ftp)

## Installation

```bash
pnpm add vite-plugin-deploy-ftp -D
```

## Quick Start

It is recommended to control whether to upload using environment variables. By default, local builds will not trigger uploading, and publishing will only happen when explicitly enabled.

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

Enable upload when building:

```bash
# macOS / Linux
DEPLOY_FTP=1 pnpm build

# Windows PowerShell
$env:DEPLOY_FTP='1'; pnpm build
```

`FTP_PATH` can be a single directory:

```env
FTP_PATH=/public_html
```

Or multiple directories separated by commas:

```env
FTP_PATH=/public_html,/backup_html
```

## Direct API

You can also upload an already-built directory without running Vite:

```js
import { deployFtp } from 'vite-plugin-deploy-ftp/deploy'

await deployFtp({
  host: process.env.FTP_HOST,
  port: +(process.env.FTP_PORT || 21),
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  alias: process.env.FTP_ALIAS,
  outDir: 'dist',
  uploadPath: '/public_html',
  autoUpload: true,
  skip: ['**/*.html'],
  manifest: true,
  configBase: `${process.env.FTP_ALIAS}/public_html/`,
})
```

## Direct CLI

Create `deploy-ftp.config.mjs`:

```js
import { defineDeployConfig } from 'vite-plugin-deploy-ftp'

export default defineDeployConfig({
  host: process.env.FTP_HOST,
  port: +(process.env.FTP_PORT || 21),
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  outDir: 'dist',
  uploadPath: '/public_html',
  autoUpload: true,
})
```

Run:

```bash
deploy-ftp --config deploy-ftp.config.mjs
```

## Configuration Guide

| Options           | Description                                                                                                                              |
| :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `open`            | Whether to enable upload. It is recommended to control this via environment variables to avoid accidental uploads during routine builds. |
| `autoUpload`      | Skip the "confirm upload" prompt. Recommended to set to `true` for automated deployments.                                                |
| `failOnError`     | Whether to make the build command fail if the upload fails. Recommended to set to `true` in CI/CD pipelines.                             |
| `outDir`          | Local directory to upload when using the direct API or CLI.                                                                              |
| `uploadPath`      | Upload directory paths. Supports string or array of strings (files will be uploaded to all specified directories).                       |
| `alias`           | Public URL / domain. If provided, the accessible URL will be printed after uploading.                                                    |
| `skip`            | Glob-like patterns for files that should not be uploaded, e.g. `**/*.html`.                                                             |
| `manifest`        | Generate and upload `ftp-manifest.json`, or pass `{ fileName }` to customize the file name.                                             |
| `configBase`      | URL base used to build manifest file URLs.                                                                                               |
| `autoDelete`      | Delete local files after each file is uploaded successfully.                                                                             |
| `singleBack`      | Whether to back up only specific files instead of the entire directory. Usually backing up `index.html` is enough and much faster.       |
| `singleBackFiles` | List of files to back up in single-backup mode, supporting sub-directories, e.g., `assets/app.js`.                                       |
| `ftps`            | Multiple FTP configurations. Used when you need to publish to multiple servers.                                                          |
| `defaultFtp`      | The default server name when configuring multiple FTPs to reduce manual selection.                                                       |
| `concurrency`     | Number of simultaneous file uploads. Keep default if the server connection is unstable.                                                  |

## Key Behaviors

- **Upload timing**: Uploads only after Vite finishes the build process.
- **Lazy evaluation**: When `open: false`, the plugin will not upload and will not validate FTP connection parameters.
- **Multiple paths**: When `uploadPath` is an array, the same build output will be uploaded sequentially to all specified paths.
- **Cross-product upload**: When combining multiple FTP servers and multiple paths, files are uploaded sequentially for every "Server × Directory" combination.
- **Backup before upload**: If the remote directory already contains files, the plugin will ask for confirmation or execute backups based on your configuration.
- **Selective backup**: When `singleBack: true` is configured, only files specified in `singleBackFiles` are backed up.
- **Manual confirmation**: When `autoUpload: false`, the plugin asks for manual confirmation in the CLI before proceeding.
- **Pipeline integration**: When `failOnError: true` and upload fails, the build command will exit with a non-zero code to block subsequent pipeline steps.
- **Module format**: This version only supports ESM (`import` syntax); `require` is not supported.

## Risks & Best Practices

- **Security**: Do not hardcode FTP usernames and passwords in `vite.config.ts`. Always use environment variables.
- **Safety**: Ensure you control the production deployments via environment variables (like `open: process.env.DEPLOY_FTP === '1'`) to prevent local routine builds from overwriting production files.
- **Multiple Targets**: Ensure all paths listed in `uploadPath` are intended targets, especially when uploading to production environments.
- **Backup Speed**: Full backups require downloading the remote directory and uploading a zip archive back. This can be slow if the remote directory is large.
- **Rate Limits**: If the remote FTP server is unstable or rate-limited, do not set `concurrency` too high.

## Examples

### Multiple FTP Servers

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

### Multiple Upload Directories

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

## Options Reference

### General Options

| Options           | Type                 | Default          | Description                                                                  |
| :---------------- | :------------------- | :--------------- | :--------------------------------------------------------------------------- |
| `open`            | `boolean`            | `true`           | Enable or disable the plugin.                                                |
| `uploadPath`      | `string \| string[]` | -                | FTP destination path(s). Array values will upload sequentially to all paths. |
| `singleBack`      | `boolean`            | `false`          | Enable single file backup mode.                                              |
| `singleBackFiles` | `string[]`           | `['index.html']` | List of file paths to back up when `singleBack` is enabled.                  |
| `debug`           | `boolean`            | `false`          | Enable verbose debug logs and duration metrics.                              |
| `maxRetries`      | `number`             | `3`              | Maximum retry attempts for connection/upload failures.                       |
| `retryDelay`      | `number`             | `1000`           | Delay between retry attempts (ms).                                           |
| `showBackFile`    | `boolean`            | `false`          | Print backup file list to the console.                                       |
| `autoUpload`      | `boolean`            | `false`          | Bypass CLI confirmation prompt before starting uploads.                      |
| `fancy`           | `boolean`            | `true`           | Enable stylish console UI outputs.                                           |
| `failOnError`     | `boolean`            | `true`           | Throw errors to fail the Vite build command on upload failure.               |
| `concurrency`     | `number`             | `1`              | Number of simultaneous file uploads.                                         |

### Single FTP Configuration

| Options    | Type     | Default | Description                                               |
| :--------- | :------- | :------ | :-------------------------------------------------------- |
| `name`     | `string` | -       | Identifier for the FTP configuration.                     |
| `host`     | `string` | -       | FTP host address.                                         |
| `port`     | `number` | `21`    | FTP port.                                                 |
| `user`     | `string` | -       | FTP username.                                             |
| `password` | `string` | -       | FTP password.                                             |
| `alias`    | `string` | `''`    | Public site URL alias used to format the final page link. |

### Multiple FTP Configuration

| Options      | Type          | Description                                      |
| :----------- | :------------ | :----------------------------------------------- |
| `ftps`       | `FtpConfig[]` | List of FTP server configurations.               |
| `defaultFtp` | `string`      | Default FTP config name to select automatically. |

### FtpConfig Object

| Options    | Type     | Default | Description                                               |
| :--------- | :------- | :------ | :-------------------------------------------------------- |
| `name`     | `string` | -       | FTP configuration name (shown in selection prompt).       |
| `host`     | `string` | -       | FTP host address.                                         |
| `port`     | `number` | `21`    | FTP port.                                                 |
| `user`     | `string` | -       | FTP username.                                             |
| `password` | `string` | -       | FTP password.                                             |
| `alias`    | `string` | `''`    | Public site URL alias used to format the final page link. |
