import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PetDefinition, PetSummary } from '../../types'

export class PetRegistry {
  constructor(private readonly petsDir: string) {}

  list(): PetSummary[] {
    return fs
      .readdirSync(this.petsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const id = entry.name
        const definition = JSON.parse(fs.readFileSync(path.join(this.petsDir, id, 'pet.json'), 'utf8')) as PetDefinition
        return { id, name: definition.name }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  load(petId: string): PetDefinition {
    const petDir = path.join(this.petsDir, petId)
    const definition = JSON.parse(fs.readFileSync(path.join(petDir, 'pet.json'), 'utf8')) as PetDefinition
    const prompt = fs.readFileSync(path.join(petDir, definition.promptFile), 'utf8')
    const spriteMap = JSON.parse(fs.readFileSync(path.join(petDir, definition.spritesFile), 'utf8')) as Record<
      string,
      string[]
    >
    const sprites = Object.fromEntries(
      Object.entries(spriteMap).map(([animation, frames]) => [
        animation,
        frames.map((frame) => (frame.startsWith('data:') ? frame : pathToFileURL(path.join(petDir, frame)).href)),
      ]),
    )
    return { ...definition, prompt, sprites }
  }
}
