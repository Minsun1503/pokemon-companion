import fs from 'node:fs'
import path from 'node:path'

function copyDirFromAsar(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name)
    const target = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      copyDirFromAsar(source, target)
    } else {
      fs.copyFileSync(source, target)
    }
  }
}

export function seedUserPets(bundledPetsDir: string, userPetsDir: string): void {
  fs.mkdirSync(userPetsDir, { recursive: true })

  for (const entry of fs.readdirSync(bundledPetsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const targetDir = path.join(userPetsDir, entry.name)
    if (fs.existsSync(targetDir)) {
      continue
    }
    copyDirFromAsar(path.join(bundledPetsDir, entry.name), targetDir)
  }
}
