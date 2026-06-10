import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { cloneTemplate, parseRepoUrl } from './github';
import { readManifest } from './manifest';
import { runPrompts } from './prompts';
import { processTemplate, processFileName, type ConfigResolver } from './template';
import type { ScaffoldTemplate, ScaffoldManifest, ScaffoldAnswers } from './types';

const CUSTOM_REPO_LABEL = '$(globe) Enter GitHub repository URL…';
const REGISTRY_URL = 'https://raw.githubusercontent.com/flyingeek/vscode-ethos-devtools/main/templates.json';

async function fetchTemplateRegistry(extensionUri: vscode.Uri): Promise<ScaffoldTemplate[]> {
    try {
        const response = await fetch(REGISTRY_URL);
        if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
        return await response.json() as ScaffoldTemplate[];
    } catch {
        // Offline or fetch failed — fall back to the bundled copy
        try {
            const bundled = vscode.Uri.joinPath(extensionUri, 'templates.json');
            const data = await fs.readFile(bundled.fsPath, 'utf-8');
            return JSON.parse(data) as ScaffoldTemplate[];
        } catch {
            return [];
        }
    }
}

/** Check whether a relative path matches any of the given glob patterns (simple star/doublestar). */
function matchesAny(relPath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
        if (simpleGlobMatch(pattern, relPath)) { return true; }
    }
    return false;
}

/** Minimal glob matcher supporting *, ** and literal paths. */
function simpleGlobMatch(pattern: string, filePath: string): boolean {
    // Exact match
    if (pattern === filePath) { return true; }
    // **/*.ext  — recursive extension match
    if (pattern.startsWith('**/')) {
        const suffix = pattern.slice(3);
        if (suffix.startsWith('*.')) {
            const ext = suffix.slice(1); // e.g. ".lua"
            return filePath.endsWith(ext);
        }
        // **/name — match filename anywhere
        return filePath.endsWith('/' + suffix) || filePath === suffix;
    }
    // dir/** — everything under dir
    if (pattern.endsWith('/**')) {
        const prefix = pattern.slice(0, -3);
        return filePath.startsWith(prefix + '/') || filePath === prefix;
    }
    // dir/* — single level under dir
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        const rest = filePath.slice(prefix.length + 1);
        return filePath.startsWith(prefix + '/') && !rest.includes('/');
    }
    // *.ext at root
    if (pattern.startsWith('*.')) {
        const ext = pattern.slice(1);
        return filePath.endsWith(ext) && !filePath.includes('/');
    }
    return false;
}

/** Recursively list all files in a directory, returning paths relative to baseDir. */
async function listAllFiles(baseDir: string): Promise<string[]> {
    const entries = await fs.readdir(baseDir, { recursive: true, withFileTypes: false }) as string[];
    const files: string[] = [];
    for (const entry of entries) {
        const full = path.join(baseDir, entry);
        const stat = await fs.stat(full);
        if (stat.isFile()) {
            files.push(entry.replace(/\\/g, '/'));
        }
    }
    return files;
}

/** Binary-safe check: return true if the file looks like a text file. */
async function isTextFile(filePath: string): Promise<boolean> {
    const buf = Buffer.alloc(512);
    const fh = await fs.open(filePath, 'r');
    try {
        const { bytesRead } = await fh.read(buf, 0, 512, 0);
        for (let i = 0; i < bytesRead; i++) {
            if (buf[i] === 0) { return false; }
        }
        return true;
    } finally {
        await fh.close();
    }
}

async function processAndCopy(
    srcDir: string,
    destDir: string,
    manifest: ScaffoldManifest | undefined,
    answers: ScaffoldAnswers,
    configResolver?: ConfigResolver,
): Promise<number> {
    const allFiles = await listAllFiles(srcDir);
    const excludePatterns = manifest?.excludePatterns ?? ['.scaffold.json'];
    const templatePatterns = manifest?.templateFilePatterns ?? [];
    const conditionalFiles = manifest?.conditionalFiles ?? {};
    let count = 0;

    for (const relPath of allFiles) {
        // Skip excluded files
        if (matchesAny(relPath, excludePatterns)) { continue; }

        // Skip conditional files whose condition is falsy
        let skip = false;
        for (const [pattern, promptId] of Object.entries(conditionalFiles)) {
            if (simpleGlobMatch(pattern, relPath) && !answers[promptId]) {
                skip = true;
                break;
            }
        }
        if (skip) { continue; }

        // Process file name through template engine
        // Rename _gitignore → .gitignore (dotfiles can't be committed directly in template repos)
        let renamed = false;
        const processedRelPath = relPath.split('/').map(seg => {
            const processed = processFileName(seg, answers, configResolver);
            if (processed === '_gitignore') { renamed = true; return '.gitignore'; }
            return processed;
        }).join('/');
        const srcFile = path.join(srcDir, relPath);
        const destFile = path.join(destDir, processedRelPath);

        await fs.mkdir(path.dirname(destFile), { recursive: true });

        // Template-process content if the file matches templateFilePatterns (original or processed name),
        // or was renamed (e.g. _gitignore), and is a text file
        const shouldTemplate = (renamed
            || (templatePatterns.length > 0
                && (matchesAny(relPath, templatePatterns) || matchesAny(processedRelPath, templatePatterns))))
            && await isTextFile(srcFile);
        if (shouldTemplate) {
            const content = await fs.readFile(srcFile, 'utf8');
            await fs.writeFile(destFile, processTemplate(content, answers, configResolver), 'utf8');
        } else {
            await fs.copyFile(srcFile, destFile);
        }
        count++;
    }
    return count;
}

export async function scaffoldCommand(extensionUri: vscode.Uri): Promise<void> {
    // Explain the process before starting
    const proceed = await vscode.window.showInformationMessage(
        'This will scaffold a new project from a GitHub template repository.\n\n'
        + '1. Choose a destination folder (empty)\n'
        + '2. Select a template\n'
        + '3. Answer a few questions (if any)\n\n'
        + 'Files will be generated with your answers applied.',
        { modal: true },
        'Continue',
    );
    if (proceed !== 'Continue') { return; }

    // 1. Choose destination folder via native folder picker
    const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const chosen = await vscode.window.showOpenDialog({
        title: 'Step 1/3: Select destination folder for the scaffolded project',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Scaffold here',
        ...(defaultUri ? { defaultUri } : {}),
    });
    if (!chosen?.length) { return; }
    const destDir = chosen[0].fsPath;

    // 2. Select a template
    const registry = await fetchTemplateRegistry(extensionUri);
    const items: vscode.QuickPickItem[] = registry.map(t => ({
        label: t.name,
        description: t.repo,
        detail: t.description,
    }));
    if (items.length > 0) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }
    items.push({ label: CUSTOM_REPO_LABEL });

    const picked = await vscode.window.showQuickPick(items, {
        title: 'Step 2/3: Scaffold New Project',
        placeHolder: 'Select a template or enter a GitHub repository URL',
    });
    if (!picked) { return; }

    let repoInput: string;
    if (picked.label === CUSTOM_REPO_LABEL) {
        const url = await vscode.window.showInputBox({
            title: 'GitHub Repository',
            placeHolder: 'owner/repo, owner/repo#branch, or full URL',
            validateInput: v => v.trim() ? null : 'Enter a repository reference',
        });
        if (!url) { return; }
        repoInput = url;
    } else {
        const template = registry.find(t => t.name === picked.label);
        repoInput = template?.repo ?? picked.description ?? '';
    }

    // Validate URL before cloning
    try {
        parseRepoUrl(repoInput);
    } catch {
        vscode.window.showErrorMessage(`Invalid repository reference: ${repoInput}`);
        return;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethos-scaffold-'));
    const templateDir = path.join(tmpDir, 'template');

    try {
        // Clone
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Scaffold: cloning template…', cancellable: false },
            () => cloneTemplate(repoInput, templateDir),
        );

        // Read manifest
        const manifest = await readManifest(templateDir);

        // 3. Answer questions
        let answers: ScaffoldAnswers = {};
        if (manifest?.prompts?.length) {
            const result = await runPrompts(manifest.prompts);
            if (!result) { return; } // user cancelled
            answers = result;
        }

        // Config resolver: ${{config.some.key}} reads from VS Code settings
        const configResolver: ConfigResolver = (key) => vscode.workspace.getConfiguration().get(key);

        // Check for file conflicts
        const templateFiles = await listAllFiles(templateDir);
        const excludePatterns = manifest?.excludePatterns ?? ['.scaffold.json'];
        const conflicting: string[] = [];
        for (const relPath of templateFiles) {
            if (matchesAny(relPath, excludePatterns)) { continue; }
            const processedRelPath = relPath.split('/').map(seg => processFileName(seg, answers, configResolver)).join('/');
            try {
                await fs.stat(path.join(destDir, processedRelPath));
                conflicting.push(processedRelPath);
            } catch {
                // file does not exist — no conflict
            }
        }
        if (conflicting.length > 0) {
            const overwrite = await vscode.window.showWarningMessage(
                `${conflicting.length} file(s) already exist in the selected folder and will be overwritten (e.g. ${conflicting[0]}).`,
                { modal: true },
                'Overwrite',
            );
            if (overwrite !== 'Overwrite') { return; }
        }

        // Process and copy
        const count = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Scaffold: generating project…', cancellable: false },
            () => processAndCopy(templateDir, destDir, manifest, answers, configResolver),
        );

        vscode.window.showInformationMessage(`Scaffolded ${count} files into ${destDir}`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Scaffold failed: ${msg}`);
    } finally {
        // Clean up temp directory
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}
