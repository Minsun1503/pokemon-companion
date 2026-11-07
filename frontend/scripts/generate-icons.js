const path = require('node:path')
const sharp = require('sharp')

const assetsDir = path.resolve(__dirname, '..', 'assets')

async function render(source, output, size) {
  await sharp(path.join(assetsDir, source)).resize(size, size).png().toFile(path.join(assetsDir, output))
}

async function main() {
  await Promise.all([
    render('icon.svg', 'icon.png', 1024),
    render('trayTemplate.svg', 'trayTemplate.png', 16),
    render('trayTemplate.svg', 'trayTemplate@2x.png', 32),
  ])
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
