import * as vscode from 'vscode'

const manifestDocUri = vscode.Uri.from({
  scheme: 'ethos-docs',
  path: '/ethos_lua_manifest.md',
})

const manifestDocUrl = 'https://raw.githubusercontent.com/FrSkyRC/ETHOS-Feedback-Community/26.1/lua/frsky/ethos_lua_manifest.md'
const manifestDocSourceUrl = 'https://github.com/FrSkyRC/ETHOS-Feedback-Community/blob/26.1/lua/frsky/ethos_lua_manifest.md'

class ManifestDocProvider implements vscode.TextDocumentContentProvider {
  private content: string | undefined
  private pendingFetch: Promise<string> | undefined

  provideTextDocumentContent(): vscode.ProviderResult<string> {
    return this.getContent()
  }

  private async getContent(): Promise<string> {
    if (this.content) {
      return this.content
    }

    this.pendingFetch ??= this.fetchContent()

    try {
      this.content = await this.pendingFetch
      return this.content
    } finally {
      this.pendingFetch = undefined
    }
  }

  private async fetchContent(): Promise<string> {
    try {
      const response = await fetch(manifestDocUrl)
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      return await response.text()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `# Ethos Lua Manifest Documentation\n\nUnable to load the manifest documentation.\n\n[Open the documentation on GitHub](${manifestDocSourceUrl})\n\n\`${message}\`\n`
    }
  }
}

export function registerManifestDocProvider(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(manifestDocUri.scheme, new ManifestDocProvider()),
  )
}

export async function openManifestDoc() {
  await vscode.commands.executeCommand('markdown.showPreview', manifestDocUri)
}
