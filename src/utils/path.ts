export const normalizeSlash = (value: string): string => value.replace(/\\/g, '/').trim()

export const normalizePathSegments = (...values: Array<string | undefined>): string =>
  values
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => normalizeSlash(value).split('/'))
    .filter(Boolean)
    .join('/')

export const normalizeFtpUploadPath = (targetPath: string): string => {
  const normalized = normalizePathSegments(targetPath)
  return normalized ? `/${normalized}` : '/'
}

export const normalizeRemotePath = (targetDir: string, relativeFilePath: string): string => {
  const normalizedTargetDir = normalizeFtpUploadPath(targetDir)
  const normalizedRelativePath = normalizePathSegments(relativeFilePath)

  if (!normalizedRelativePath) return normalizedTargetDir
  if (normalizedTargetDir === '/') return `/${normalizedRelativePath}`
  return `${normalizedTargetDir}/${normalizedRelativePath}`
}

const splitUrlLikeBase = (value: string): { prefix: string; path: string } => {
  const normalized = normalizeSlash(value)
  const protocolMatch = normalized.match(/^([a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/]+)(.*)$/)
  if (protocolMatch) {
    return {
      prefix: protocolMatch[1],
      path: protocolMatch[2] || '',
    }
  }

  const protocolRelativeMatch = normalized.match(/^(\/\/[^/]+)(.*)$/)
  if (protocolRelativeMatch) {
    return {
      prefix: protocolRelativeMatch[1],
      path: protocolRelativeMatch[2] || '',
    }
  }

  if (normalized.startsWith('/')) {
    return {
      prefix: '/',
      path: normalized,
    }
  }

  return {
    prefix: '',
    path: normalized,
  }
}

export const normalizeUrlLikeBase = (base: string): string => {
  const { prefix, path } = splitUrlLikeBase(base)
  const normalizedPath = normalizePathSegments(path)

  if (!prefix) return normalizedPath
  if (!normalizedPath) return prefix
  if (prefix === '/') return `/${normalizedPath}`

  return `${prefix}/${normalizedPath}`
}

export const normalizeSelectionPath = (value: string): string => normalizePathSegments(value)

export const joinUrlLikePath = (base: string, targetPath: string): string => {
  const normalizedBase = normalizeUrlLikeBase(base).replace(/\/+$/, '')
  const normalizedTargetPath = normalizePathSegments(targetPath)

  if (!normalizedTargetPath) return normalizedBase
  if (!normalizedBase) return `/${normalizedTargetPath}`

  return `${normalizedBase}/${normalizedTargetPath}`
}

export const resolveDisplayUrl = (alias: string | undefined, targetPath: string): string => {
  const normalizedTargetPath = normalizeFtpUploadPath(targetPath)

  if (!alias) return normalizedTargetPath
  return joinUrlLikePath(alias, normalizedTargetPath)
}
