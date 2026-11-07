const fs = require('node:fs')
const path = require('node:path')

function validatePet(petId, petsDir = path.resolve(__dirname, '..', 'pets')) {
  const petDir = path.resolve(petsDir, petId)
  const errors = []

  function readJson(fileName) {
    const filePath = path.join(petDir, fileName)
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (error) {
      errors.push(`${fileName}: ${error.message}`)
      return null
    }
  }

  const definition = readJson('pet.json')
  if (definition) {
    if (definition.id !== petId) errors.push(`pet.json id must be "${petId}"`)
    for (const key of [
      'name',
      'promptFile',
      'spritesFile',
      'appearance',
      'movement',
      'theme',
      'recallText',
      'responseCryKeywords',
    ]) {
      if (!definition[key]) errors.push(`pet.json is missing "${key}"`)
    }
    if (!Array.isArray(definition.responseCryKeywords)) {
      errors.push('pet.json "responseCryKeywords" must be an array')
    } else if (definition.responseCryKeywords.some((keyword) => typeof keyword !== 'string')) {
      errors.push('pet.json "responseCryKeywords" must contain only strings')
    }
    if (definition.theme) {
      for (const key of [
        'accentColor',
        'accentHoverColor',
        'accentGlowColor',
        'assistantBackground',
        'assistantBorderColor',
      ]) {
        if (typeof definition.theme[key] !== 'string' || !definition.theme[key]) {
          errors.push(`pet.json theme is missing "${key}"`)
        }
      }
    }

    if (definition.promptFile && !fs.existsSync(path.join(petDir, definition.promptFile))) {
      errors.push(`Missing prompt file: ${definition.promptFile}`)
    }

    if (definition.spritesFile) {
      const sprites = readJson(definition.spritesFile)
      if (sprites) {
        for (const animation of ['down', 'side', 'back_side', 'back_up']) {
          if (!Array.isArray(sprites[animation]) || sprites[animation].length === 0) {
            errors.push(`sprites.json "${animation}" must contain at least one frame`)
            continue
          }
          for (const frame of sprites[animation]) {
            if (typeof frame !== 'string') {
              errors.push(`sprites.json "${animation}" contains a non-string frame`)
            } else if (!frame.startsWith('data:') && !fs.existsSync(path.join(petDir, frame))) {
              errors.push(`Missing sprite frame: ${frame}`)
            }
          }
        }
      }
    }
  }

  return errors
}

if (require.main === module) {
  const petId = process.argv[2]
  if (!petId) {
    console.error('Usage: npm run validate:pet -- <pet-id>')
    process.exit(1)
  }

  const errors = validatePet(petId)
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join('\n'))
    process.exit(1)
  }

  console.log(`Pet "${petId}" is valid.`)
}

module.exports = { validatePet }
