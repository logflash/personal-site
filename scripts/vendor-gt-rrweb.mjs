import { createHash } from 'node:crypto'
import { cp, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const UPSTREAM_REPOSITORY = 'https://github.com/generaltranslation/gt.git'
const UPSTREAM_TAG = 'gt-rrweb@0.2.0'
const UPSTREAM_COMMIT = 'ad4f69ed7847a055ea555a102f4e597b7a138d5d'
const UPSTREAM_PACKAGE_TREE = 'f8a44c1d425da0a993a6783b01cdb237681052ab'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..')
const targetDirectory = resolve(repositoryRoot, 'repos', 'gt-rrweb')
const patchDirectory = resolve(repositoryRoot, 'patches', 'gt-rrweb-source')
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules'])
const ignoredFiles = new Set(['tsconfig.tsbuildinfo'])

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  })

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`)
  }

  return result.stdout?.trim() ?? ''
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function listFiles(root, directory = root) {
  const files = []
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    if (entry.isFile() && ignoredFiles.has(entry.name)) continue

    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(root, absolutePath)))
    else if (entry.isFile()) files.push(relative(root, absolutePath).replaceAll('\\', '/'))
  }

  return files
}

async function normalizedHash(path) {
  const bytes = await readFile(path)
  const normalized = bytes.includes(0)
    ? bytes
    : Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
  return createHash('sha256').update(normalized).digest('hex')
}

async function compareTrees(expectedRoot, actualRoot) {
  const expectedFiles = await listFiles(expectedRoot)
  const actualFiles = await listFiles(actualRoot)
  const allFiles = [...new Set([...expectedFiles, ...actualFiles])].sort()
  const differences = []

  for (const file of allFiles) {
    if (!expectedFiles.includes(file)) {
      differences.push(`unexpected ${file}`)
      continue
    }
    if (!actualFiles.includes(file)) {
      differences.push(`missing ${file}`)
      continue
    }
    const [expectedHash, actualHash] = await Promise.all([
      normalizedHash(join(expectedRoot, file)),
      normalizedHash(join(actualRoot, file)),
    ])
    if (expectedHash !== actualHash) differences.push(`changed ${file}`)
  }

  return differences
}

function parseArguments(argv) {
  let source
  let mode = 'check'

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--source') {
      source = argv[index + 1]
      if (!source) throw new Error('--source requires a General Translation checkout path')
      index += 1
    } else if (argument === '--write') {
      mode = 'write'
    } else if (argument === '--check') {
      mode = 'check'
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  return { mode, source: source ? resolve(source) : undefined }
}

async function verifyUpstreamCheckout(checkout) {
  const safeDirectory = `safe.directory=${checkout.replaceAll('\\', '/')}`
  const commit = run('git', ['-c', safeDirectory, 'rev-parse', 'HEAD'], { cwd: checkout })
  const packageTree = run('git', ['-c', safeDirectory, 'rev-parse', 'HEAD:packages/rrweb'], {
    cwd: checkout,
  })

  if (commit !== UPSTREAM_COMMIT) {
    throw new Error(`Expected upstream commit ${UPSTREAM_COMMIT}, received ${commit}`)
  }
  if (packageTree !== UPSTREAM_PACKAGE_TREE) {
    throw new Error(`Expected package tree ${UPSTREAM_PACKAGE_TREE}, received ${packageTree}`)
  }
}

async function createPatchedTree(source, workingDirectory) {
  let checkout = source
  if (!checkout) {
    checkout = join(workingDirectory, 'generaltranslation-gt')
    run(
      'git',
      [
        'clone',
        '--filter=blob:none',
        '--no-checkout',
        '--branch',
        UPSTREAM_TAG,
        '--depth',
        '1',
        UPSTREAM_REPOSITORY,
        checkout,
      ],
      { inherit: true },
    )
    run('git', ['checkout', '--detach', UPSTREAM_COMMIT], { cwd: checkout })
  }

  await verifyUpstreamCheckout(checkout)

  const stagingDirectory = join(workingDirectory, 'gt-rrweb')
  await cp(join(checkout, 'packages', 'rrweb'), stagingDirectory, { recursive: true })

  const patchFiles = (await readdir(patchDirectory))
    .filter((file) => file.endsWith('.patch'))
    .sort()
  if (patchFiles.length === 0) throw new Error(`No source patches found in ${patchDirectory}`)

  for (const patchFile of patchFiles) {
    const patchPath = join(patchDirectory, patchFile)
    run('git', ['apply', '--check', '--whitespace=nowarn', patchPath], {
      cwd: stagingDirectory,
    })
    run('git', ['apply', '--whitespace=nowarn', patchPath], { cwd: stagingDirectory })
  }

  return { patchFiles, stagingDirectory }
}

async function replaceTarget(stagingDirectory) {
  const expectedTarget = resolve(repositoryRoot, 'repos', 'gt-rrweb')
  if (
    targetDirectory !== expectedTarget ||
    dirname(targetDirectory) !== resolve(repositoryRoot, 'repos')
  ) {
    throw new Error(`Refusing to replace unexpected target: ${targetDirectory}`)
  }

  const backupDirectory = resolve(repositoryRoot, 'repos', `.gt-rrweb-backup-${process.pid}`)
  if (await exists(backupDirectory)) {
    throw new Error(`Refusing to overwrite existing backup: ${backupDirectory}`)
  }

  const hadTarget = await exists(targetDirectory)
  if (hadTarget) await rename(targetDirectory, backupDirectory)

  try {
    await cp(stagingDirectory, targetDirectory, { recursive: true })
    const differences = await compareTrees(stagingDirectory, targetDirectory)
    if (differences.length > 0) {
      throw new Error(`Copied fork failed verification:\n${differences.join('\n')}`)
    }
    if (hadTarget) await rm(backupDirectory, { recursive: true, force: true })
  } catch (error) {
    await rm(targetDirectory, { recursive: true, force: true })
    if (hadTarget) await rename(backupDirectory, targetDirectory)
    throw error
  }
}

async function main() {
  const { mode, source } = parseArguments(process.argv.slice(2))
  const workingDirectory = await mkdtemp(join(tmpdir(), 'vendor-gt-rrweb-'))

  try {
    const { patchFiles, stagingDirectory } = await createPatchedTree(source, workingDirectory)

    if (mode === 'write') {
      await replaceTarget(stagingDirectory)
      console.log(
        `Vendored gt-rrweb@0.2.0 from ${UPSTREAM_COMMIT} and applied ${patchFiles.length} source patches.`,
      )
      return
    }

    const differences = await compareTrees(stagingDirectory, targetDirectory)
    if (differences.length > 0) {
      throw new Error(
        `Checked-in fork does not match the reproducible vendored tree:\n${differences.join('\n')}`,
      )
    }
    console.log(
      `Verified gt-rrweb@0.2.0 at ${UPSTREAM_COMMIT}; ${patchFiles.length} source patches reproduce repos/gt-rrweb exactly.`,
    )
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}

await main()
