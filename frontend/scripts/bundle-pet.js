const fs = require('node:fs')
const path = require('node:path')

const projectDir = path.resolve(__dirname, '..')
const petId = process.argv[2]
const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(projectDir, 'assets', petId || '', `${petId}.bundle.json`)

if (!petId) {
  console.error('Usage: npm run bundle:pet -- <pet-id> [output.bundle.json]')
  process.exit(1)
}

const petDir = path.join(projectDir, 'pets', petId)
const readJson = (fileName) => JSON.parse(fs.readFileSync(path.join(petDir, fileName), 'utf8'))
const pet = readJson('pet.json')
const prompt = fs.readFileSync(path.join(petDir, pet.promptFile), 'utf8')
const sprites = readJson(pet.spritesFile)
const manifestPath = path.join(petDir, pet.spritesManifestFile || 'sprites-manifest.json')
const bundle = {
  formatVersion: 1,
  pet,
  prompt,
  sprites: { data: sprites },
}
if (fs.existsSync(manifestPath)) bundle.manifest = readJson(path.basename(manifestPath))

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`)
console.log(`Created ${path.relative(projectDir, outputPath)}`)
