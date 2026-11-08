import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'rolldown';
import { describe, expect, it, afterAll } from 'bun:test';
import userscript from '../src/index.js';

const tmpDir = join(import.meta.dir, '.tmp-integration');

function cleanup() {
	rmSync(tmpDir, { recursive: true, force: true });
}

function setup(files: Record<string, string>) {
	cleanup();
	mkdirSync(tmpDir, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(tmpDir, name), content);
	}
}

async function buildAndReturn(
	files: Record<string, string>,
	entry: string,
	options?: Parameters<typeof userscript>[0],
) {
	setup(files);
	try {
		const result = await build({
			input: join(tmpDir, entry),
			plugins: [userscript(options)],
			write: false,
		});
		for (const chunk of result.output) {
			if ('code' in chunk) return chunk.code;
		}
		return '';
	} finally {
		cleanup();
	}
}

describe('auto-grant detection (integration)', () => {
	afterAll(cleanup);

	it('should auto-detect GM_setValue and GM_getValue', async () => {
		const code = await buildAndReturn(
			{
				'metadata.js': `// ==UserScript==
// @name Test
// @version 1.0
// ==/UserScript==`,
				'entry.js': `import "./metadata.js?userscript-metadata";
GM_setValue("key", "value");
console.log(GM_getValue("key"));`,
			},
			'entry.js',
		);
		expect(code).toContain('@grant');
		expect(code).toContain('GM_getValue');
		expect(code).toContain('GM_setValue');
	});

	it('should auto-detect GM_xmlhttpRequest', async () => {
		const code = await buildAndReturn(
			{
				'metadata.js': `// ==UserScript==
// @name Test
// ==/UserScript==`,
				'entry.js': `import "./metadata.js?userscript-metadata";
GM_xmlhttpRequest({ url: "https://example.com" });`,
			},
			'entry.js',
		);
		expect(code).toContain('@grant GM_xmlhttpRequest');
	});

	it('should auto-detect unsafeWindow', async () => {
		const code = await buildAndReturn(
			{
				'metadata.js': `// ==UserScript==
// @name Test
// ==/UserScript==`,
				'entry.js': `import "./metadata.js?userscript-metadata";
console.log(unsafeWindow.document);`,
			},
			'entry.js',
		);
		expect(code).toContain('@grant unsafeWindow');
	});

	it('should merge auto-detected grants with explicit @grant', async () => {
		const code = await buildAndReturn(
			{
				'metadata.js': `// ==UserScript==
// @name Test
// @grant GM_addStyle
// ==/UserScript==`,
				'entry.js': `import "./metadata.js?userscript-metadata";
GM_setValue("key", "value");`,
			},
			'entry.js',
		);
		expect(code).toContain('@grant GM_addStyle');
		expect(code).toContain('@grant GM_setValue');
	});

	it('should deduplicate auto-detected grants with explicit @grant', async () => {
		const code = await buildAndReturn(
			{
				'metadata.js': `// ==UserScript==
// @name Test
// @grant GM_setValue
// ==/UserScript==`,
				'entry.js': `import "./metadata.js?userscript-metadata";
GM_setValue("key", "value");`,
			},
			'entry.js',
		);
		const grantLines = code.split('\n').filter((l) => l.includes('@grant GM_setValue'));
		expect(grantLines).toHaveLength(1);
	});

	it('should sort grants alphabetically', async () => {
		const code = await buildAndReturn(
			{
				'metadata.js': `// ==UserScript==
// @name Test
// ==/UserScript==`,
				'entry.js': `import "./metadata.js?userscript-metadata";
GM_setValue("a", "1");
GM_getValue("a");
GM_xmlhttpRequest({});`,
			},
			'entry.js',
		);
		const grantLines = code.split('\n').filter((l) => l.includes('@grant'));
		expect(grantLines).toEqual([
			expect.stringContaining('@grant GM_getValue'),
			expect.stringContaining('@grant GM_setValue'),
			expect.stringContaining('@grant GM_xmlhttpRequest'),
		]);
	});

	it('should respect ignoreAutomaticGrants option', async () => {
		const code = await buildAndReturn(
			{
				'metadata.js': `// ==UserScript==
// @name Test
// ==/UserScript==`,
				'entry.js': `import "./metadata.js?userscript-metadata";
GM_setValue("key", "value");
GM_getValue("key");`,
			},
			'entry.js',
			{ ignoreAutomaticGrants: ['GM_getValue'] },
		);
		expect(code).toContain('@grant GM_setValue');
		expect(code).not.toContain('@grant GM_getValue');
	});

	it('should not produce a banner for chunks without metadata import', async () => {
		const code = await buildAndReturn(
			{
				'entry.js': `console.log("no metadata");`,
			},
			'entry.js',
		);
		expect(code).not.toContain('@grant');
		expect(code).not.toContain('==UserScript==');
	});

	it('should work with the transform option', async () => {
		const code = await buildAndReturn(
			{
				'metadata.js': `// ==UserScript==
// @name Test
// ==/UserScript==`,
				'entry.js': `import "./metadata.js?userscript-metadata";
GM_setValue("key", "value");`,
			},
			'entry.js',
			(meta) => meta.replace(/@name\s+Test/, '@name Transformed'),
		);
		expect(code).toContain('Transformed');
		expect(code).toContain('GM_setValue');
	});
});
