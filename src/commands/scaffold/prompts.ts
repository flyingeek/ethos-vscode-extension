import * as vscode from 'vscode';
import type { ScaffoldPrompt, ScaffoldAnswers } from './types';

/**
 * Run the interactive prompt sequence defined in a scaffold manifest.
 * Returns the collected answers, or undefined if the user cancelled.
 */
export async function runPrompts(prompts: ScaffoldPrompt[]): Promise<ScaffoldAnswers | undefined> {
    const answers: ScaffoldAnswers = {};
    const total = prompts.length;

    for (let i = 0; i < total; i++) {
        const prompt = prompts[i];
        const step = `(${i + 1}/${total})`;

        switch (prompt.type) {
            case 'input': {
                const value = await vscode.window.showInputBox({
                    title: `${step} ${prompt.message}`,
                    value: typeof prompt.default === 'string' ? prompt.default : undefined,
                    validateInput: prompt.validate
                        ? (v) => new RegExp(prompt.validate!).test(v) ? null : `Must match ${prompt.validate}`
                        : undefined,
                });
                if (value === undefined) { return undefined; }
                answers[prompt.id] = value;
                break;
            }

            case 'select': {
                if (!prompt.options?.length) {
                    throw new Error(`Scaffold prompt "${prompt.id}": select type requires options`);
                }
                const picked = await vscode.window.showQuickPick(prompt.options, {
                    title: `${step} ${prompt.message}`,
                });
                if (picked === undefined) { return undefined; }
                answers[prompt.id] = picked;
                break;
            }

            case 'confirm': {
                const yes: vscode.QuickPickItem = { label: 'Yes' };
                const no: vscode.QuickPickItem = { label: 'No' };
                const items = prompt.default === false ? [no, yes] : [yes, no];
                const picked = await vscode.window.showQuickPick(items, {
                    title: `${step} ${prompt.message}`,
                });
                if (picked === undefined) { return undefined; }
                answers[prompt.id] = picked.label === 'Yes';
                break;
            }

            default:
                throw new Error(`Scaffold prompt "${prompt.id}": unknown type "${(prompt as ScaffoldPrompt).type}"`);
        }
    }

    return answers;
}
