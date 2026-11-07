const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createPetFromBundle } = require('./create-pet-from-bundle')
const { validatePet } = require('./validate-pet')

const projectDir = path.resolve(__dirname, '..')
const petsDir = path.join(projectDir, 'pets')

function parseArgs(args) {
  const options = {
    force: false,
    keepAssets: false,
    activate: false,
  }
  let bundlePath
  for (const arg of args) {
    if (arg === '--force') options.force = true
    else if (arg === '--keep-assets') options.keepAssets = true
    else if (arg === '--activate') options.activate = true
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`)
    else if (!bundlePath) bundlePath = arg
    else throw new Error(`Unexpected argument: ${arg}`)
  }
  if (!bundlePath) {
    throw new Error('Usage: npm run install:pet -- <bundle.json> [--force] [--keep-assets] [--activate]')
  }
  return { bundlePath: path.resolve(bundlePath), ...options }
}

function activatePet(petId) {
  const settingsPath = path.join(projectDir, 'config', 'setting.json')
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  settings.pet = { ...(settings.pet || {}), active: petId }
  const temporaryPath = `${settingsPath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`)
  fs.renameSync(temporaryPath, settingsPath)
}

function cleanAssets(bundleDir) {
  const assetsDir = path.join(projectDir, 'assets')
  const relative = path.relative(assetsDir, bundleDir)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    console.log(`Keeping assets outside assets/<pet-id>: ${bundleDir}`)
    return
  }
  fs.rmSync(bundleDir, { recursive: true, force: true })
  console.log(`Removed temporary assets: ${path.relative(projectDir, bundleDir)}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(options.bundlePath)) throw new Error(`Bundle not found: ${options.bundlePath}`)
  const bundle = JSON.parse(fs.readFileSync(options.bundlePath, 'utf8'))
  const pet =
    typeof bundle.pet === 'string'
      ? JSON.parse(fs.readFileSync(path.resolve(path.dirname(options.bundlePath), bundle.pet), 'utf8'))
      : bundle.pet
  const petId = pet?.id
  if (!petId) throw new Error('Bundle pet definition is missing id')

  const targetDir = path.join(petsDir, petId)
  if (fs.existsSync(targetDir) && !options.force) {
    throw new Error(`pets/${petId} already exists. Pass --force to replace it.`)
  }

  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-pet-install-'))
  const backupDir = path.join(backupRoot, petId)
  const settingsPath = path.join(projectDir, 'config', 'setting.json')
  const previousSettings = options.activate ? fs.readFileSync(settingsPath, 'utf8') : null
  if (fs.existsSync(targetDir)) fs.renameSync(targetDir, backupDir)

  try {
    await createPetFromBundle(options.bundlePath, petsDir)
    const errors = validatePet(petId, petsDir)
    if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join('\n'))
    if (options.activate) activatePet(petId)
    if (!options.keepAssets) cleanAssets(path.dirname(options.bundlePath))
    console.log(`Installed and validated pets/${petId}`)
  } catch (error) {
    fs.rmSync(targetDir, { recursive: true, force: true })
    if (fs.existsSync(backupDir)) fs.renameSync(backupDir, targetDir)
    if (previousSettings !== null) fs.writeFileSync(settingsPath, previousSettings)
    throw error
  } finally {
    fs.rmSync(backupRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
