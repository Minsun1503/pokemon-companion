import fs from 'node:fs'
import path from 'node:path'

export class PetScopedStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly petId: string,
    private readonly fallbackValue: T,
    private readonly isValue: (value: unknown) => value is T,
  ) {}

  read(): T {
    const stored = this.readRaw()
    if (this.isRecord(stored)) {
      const scopedValue = stored[this.petId]
      if (this.isValue(scopedValue)) {
        return scopedValue
      }
    }
    return this.fallbackValue
  }

  write(value: T): boolean {
    const stored = this.readRaw()
    const scoped = this.isRecord(stored) ? stored : {}
    return this.writeAll({ ...scoped, [this.petId]: value })
  }

  private readRaw(): unknown {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {}
      }
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown
    } catch {
      return {}
    }
  }

  private writeAll(value: Record<string, unknown>): boolean {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(value), 'utf8')
      return true
    } catch {
      return false
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}
