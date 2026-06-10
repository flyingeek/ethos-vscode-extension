export interface ScaffoldPrompt {
    id: string;
    type: 'input' | 'select' | 'confirm';
    message: string;
    default?: string | boolean;
    /** Regex pattern string for input validation (type === 'input' only). */
    validate?: string;
    /** Options for select prompts. */
    options?: string[];
}

export interface ScaffoldManifest {
    name: string;
    description?: string;
    version: 1;
    prompts?: ScaffoldPrompt[];
    /** Glob patterns for files that should be processed through the template engine. */
    templateFilePatterns?: string[];
    /** Glob patterns for files/dirs to exclude from the output. */
    excludePatterns?: string[];
    /** Map of glob pattern → prompt id. Files matching the pattern are only included when the prompt answer is truthy. */
    conditionalFiles?: Record<string, string>;
}

export type ScaffoldAnswers = Record<string, string | boolean>;

export interface ScaffoldTemplate {
    name: string;
    description?: string;
    repo: string;
}
