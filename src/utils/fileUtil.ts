export class FileUtil {
  private static createInput(accept?: string, multiple = false) {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = accept ?? ""
    input.multiple = multiple
    input.style.display = "none"
    document.body.appendChild(input)
    return input
  }

  static pickFiles(accept?: string, multiple = false): Promise<File[]> {
    return new Promise((resolve) => {
      const input = this.createInput(accept, multiple)

      input.onchange = () => {
        const files = input.files ? Array.from(input.files) : []
        document.body.removeChild(input)
        resolve(files)
      }

      input.click()
    })
  }

  static async pickFile(accept?: string): Promise<File | null> {
    const files = await this.pickFiles(accept, false)
    return files[0] ?? null
  }

  static async pickText(accept?: string): Promise<string | null> {
    const file = await this.pickFile(accept)
    if (!file) return null
    return await file.text()
  }

  static async pickJSON<T = any>(accept = ".json"): Promise<T | null> {
    const text = await this.pickText(accept)
    if (!text) return null
    return JSON.parse(text) as T
  }

  static async pickArrayBuffer(accept?: string): Promise<ArrayBuffer | null> {
    const file = await this.pickFile(accept)
    if (!file) return null
    return await file.arrayBuffer()
  }

  static async pickDataURL(accept?: string): Promise<string | null> {
    const file = await this.pickFile(accept)
    if (!file) return null

    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    })
  }

  static async pickImageURL(): Promise<string | null> {
    const file = await this.pickFile("image/*")
    if (!file) return null
    return URL.createObjectURL(file)
  }
}