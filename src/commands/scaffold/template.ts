import type { ScaffoldAnswers } from './types';

function toKebabCase(s: string): string {
    return s
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase();
}

const filters: Record<string, (s: string) => string> = {
    lowercase: s => s.toLowerCase(),
    uppercase: s => s.toUpperCase(),
    kebabcase: s => toKebabCase(s),
    basename: s => s.split(/[/\\]/).pop() ?? s,
};

const TOKEN_RE = /\$\{\{([\w.]+)(?:\s*\|\s*([^}]+))?\}\}/g;

const CONFIG_PREFIX = 'config.';

/** Optional resolver for config.* tokens (e.g. VS Code settings). */
export type ConfigResolver = (key: string) => unknown;

/** Replace ${{id}}, ${{id | filter}}, and ${{config.key}} tokens in a string. */
export function processTemplate(content: string, answers: ScaffoldAnswers, configResolver?: ConfigResolver): string {
    return content.replace(TOKEN_RE, (_match, id: string, filter?: string) => {
        let value: unknown;
        if (id.startsWith(CONFIG_PREFIX) && configResolver) {
            value = configResolver(id.slice(CONFIG_PREFIX.length));
        } else {
            value = answers[id];
        }
        if (value === undefined) { return _match; }
        let str = String(value);
        if (filter) {
            const names = filter
                .split('|')
                .map(name => name.trim())
                .filter(Boolean);

            for (const name of names) {
                const fn = filters[name.toLowerCase()];
                if (fn) {
                    str = fn(str);
                }
            }
        }
        return str;
    });
}

/** Replace ${{id}} tokens in file/directory names.
 *  Normalises backslashes to forward slashes for cross-platform consistency
 *  and strips path traversal segments. */
export function processFileName(name: string, answers: ScaffoldAnswers, configResolver?: ConfigResolver): string {
    return processTemplate(name, answers, configResolver)
        .replace(/\\/g, '/')
        .split('/')
        .filter(seg => seg !== '..' && seg !== '')
        .join('/');
}
