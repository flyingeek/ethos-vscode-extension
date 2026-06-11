import assert from 'node:assert/strict';
import test from 'node:test';

import { processTemplate } from '../../../src/commands/scaffold/template';

const answers = {
    id: '/tmp/My App/thing.txt',
} as const;

test('processTemplate supports chained filters', () => {
    const result = processTemplate('${{id|basename|uppercase}}', answers);

    assert.equal(result, 'THING.TXT');
});

test('processTemplate preserves unknown filters as literal text', () => {
    const result = processTemplate('${{id|basename|uppercase|unknown}}', answers);

    assert.equal(result, 'THING.TXT');
});
