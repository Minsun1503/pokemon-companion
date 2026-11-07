const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const REQUIRED_ANIMATIONS = ['down', 'side', 'back_side', 'back_up']

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function resolveJson(baseDir, value, label) {
  if (typeof value === 'string') return readJson(path.resolve(baseDir, value))
  if (value && typeof value.file === 'string') return readJson(path.resolve(baseDir, value.file))
  if (value && typeof value === 'object') return value
  throw new Error(`Bundle is missing "${label}"`)
}

function resolvePrompt(baseDir, value) {
  if (typeof value === 'string') return value
  if (value && typeof value.file === 'string') {
    return fs.readFileSync(path.resolve(baseDir, value.file), 'utf8')
  }
  throw new Error('Bundle is missing "prompt"')
}

function normalizeRect(frame) {
  if (frame.source_bbox) {
    const { left, top, right, bottom } = frame.source_bbox
    return { left, top, width: right - left + 1, height: bottom - top + 1 }
  }
  const left = frame.left ?? frame.x
  const top = frame.top ?? frame.y
  const width = frame.width
  const height = frame.height
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error(`Invalid frame rectangle: ${JSON.stringify(frame)}`)
  }
  return { left, top, width, height }
}

function removeBackground(data, background, tolerance) {
  const [red, green, blue, alpha = 255] = background
  for (let offset = 0; offset < data.length; offset += 4) {
    if (
      Math.abs(data[offset] - red) <= tolerance &&
      Math.abs(data[offset + 1] - green) <= tolerance &&
      Math.abs(data[offset + 2] - blue) <= tolerance &&
      Math.abs(data[offset + 3] - alpha) <= tolerance
    ) {
      data[offset + 3] = 0
    }
  }
  return data
}

async function renderFrame(sourcePath, frame, options) {
  const rect = normalizeRect(frame)
  const margin = frame.margin ?? options.margin ?? 0
  const sourceMetadata = await sharp(sourcePath).metadata()
  const left = Math.max(0, rect.left - margin)
  const top = Math.max(0, rect.top - margin)
  const right = Math.min(sourceMetadata.width, rect.left + rect.width + margin)
  const bottom = Math.min(sourceMetadata.height, rect.top + rect.height + margin)
  const extracted = await sharp(sourcePath)
    .extract({ left, top, width: right - left, height: bottom - top })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const transparent = removeBackground(extracted.data, options.backgroundRgba || [0, 0, 0, 0], options.tolerance || 0)
  const trimmed = await sharp(transparent, { raw: extracted.info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const canvas = options.canvas || {}
  const width = canvas.width
  const height = canvas.height
  const bottomPadding = canvas.bottomPadding || 0
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('Generated sprites require integer canvas.width and canvas.height')
  }

  const fitted = await sharp(trimmed)
    .resize({
      width,
      height: height - bottomPadding,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer()
  const fittedMetadata = await sharp(fitted).metadata()
  const leftPadding = Math.floor((width - fittedMetadata.width) / 2)
  const topPadding = height - bottomPadding - fittedMetadata.height
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: fitted, left: leftPadding, top: topPadding }])
    .png()
    .toBuffer()
}

async function generateSprites(bundleDir, descriptor) {
  if (descriptor.data) return descriptor.data
  if (descriptor.file) return readJson(path.resolve(bundleDir, descriptor.file))

  const sourcePath = path.resolve(bundleDir, descriptor.source)
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing source image: ${descriptor.source}`)
  const sprites = {}
  const manifestFrames = {}
  for (const [animation, frames] of Object.entries(descriptor.animations || {})) {
    if (!Array.isArray(frames)) throw new Error(`Animation "${animation}" must be an array`)
    sprites[animation] = []
    manifestFrames[animation] = []
    for (const [index, frame] of frames.entries()) {
      const png = await renderFrame(sourcePath, frame, descriptor)
      sprites[animation].push(`data:image/png;base64,${png.toString('base64')}`)
      manifestFrames[animation].push({
        index: index + 1,
        source_bbox: normalizeRect(frame),
        output_canvas: descriptor.canvas,
      })
    }
  }

  for (const animation of REQUIRED_ANIMATIONS) {
    if (!sprites[animation]?.length) throw new Error(`Animation "${animation}" has no frames`)
  }
  const sourceMetadata = await sharp(sourcePath).metadata()
  return {
    sprites,
    manifest: {
      source_sheet: {
        filename: path.basename(sourcePath),
        size: { width: sourceMetadata.width, height: sourceMetadata.height },
        background_rgba: descriptor.backgroundRgba,
      },
      method: 'Generated by scripts/create-pet-from-bundle.js',
      normalized_canvas: descriptor.canvas,
      frames: manifestFrames,
    },
  }
}

async function createPetFromBundle(bundlePath, petsDir) {
  const absoluteBundlePath = path.resolve(bundlePath)
  const bundleDir = path.dirname(absoluteBundlePath)
  const bundle = readJson(absoluteBundlePath)
  if (bundle.formatVersion !== 1) throw new Error('Unsupported bundle formatVersion')

  const pet = resolveJson(bundleDir, bundle.pet, 'pet')
  if (!/^[a-z0-9-]+$/.test(pet.id || '')) throw new Error('pet.id must use lowercase letters, numbers, or hyphens')
  const prompt = resolvePrompt(bundleDir, bundle.prompt)
  const descriptor = resolveJson(bundleDir, bundle.sprites || bundle.assets, 'sprites')
  const generated = await generateSprites(bundleDir, descriptor)
  const sprites = generated.sprites || generated
  const manifest = bundle.manifest
    ? resolveJson(bundleDir, bundle.manifest, 'manifest')
    : generated.manifest || { generatedBy: 'scripts/create-pet-from-bundle.js' }

  const petDir = path.resolve(petsDir, pet.id)
  fs.mkdirSync(petDir, { recursive: true })
  pet.promptFile = 'prompt.txt'
  pet.spritesFile = 'sprites.json'
  pet.spritesManifestFile = 'sprites-manifest.json'
  writeJson(path.join(petDir, 'pet.json'), pet)
  fs.writeFileSync(path.join(petDir, 'prompt.txt'), prompt.endsWith('\n') ? prompt : `${prompt}\n`)
  writeJson(path.join(petDir, 'sprites.json'), sprites)
  writeJson(path.join(petDir, 'sprites-manifest.json'), manifest)
  return { petId: pet.id, petDir, bundleDir }
}

if (require.main === module) {
  const bundlePath = process.argv[2]
  if (!bundlePath) {
    console.error('Usage: node scripts/create-pet-from-bundle.js <bundle.json> [pets-dir]')
    process.exit(1)
  }
  const petsDir = process.argv[3] || path.resolve(__dirname, '..', 'pets')
  createPetFromBundle(bundlePath, petsDir)
    .then(({ petId }) => console.log(`Created pets/${petId}`))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}

module.exports = { createPetFromBundle }
