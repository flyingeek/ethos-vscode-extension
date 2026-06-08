import * as vscode from 'vscode'

export async function openManifestDoc() {
  const url = 'https://github.com/FrSkyRC/ETHOS-Feedback-Community/blob/26.1/lua/frsky/ethos_lua_manifest.md'
  // vscode.env.openExternal(vscode.Uri.parse(url))
  vscode.commands.executeCommand('simpleBrowser.show', url)
}
