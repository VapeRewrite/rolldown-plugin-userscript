import { parse } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { collectGrants, getMetadata } from '../src/util';

describe('collectGrants', () => {
	const parseCode = async (code: string) => {
		return (await parse('file', code)).program;
	};

	it('should return an empty set on an empty input', async () => {
		const astNode = await parseCode(``);
		const result = collectGrants(astNode);

		expect(result.size).toBe(0);
	});

	it('should return only GM_dummyApi', async () => {
		const astNode = await parseCode(`GM_dummyApi`);
		const result = collectGrants(astNode);

		expect(result.size).toBe(1);
		expect(result).toContain('GM_dummyApi');
	});

	it('should ignore any scope-defined variables that look like GM APIs', async () => {
		const astNode = await parseCode(`
      let GM_dummyApi;
      GM_dummyApi;
    `);
		const result = collectGrants(astNode);

		expect(result.size).toBe(0);
	});

	it('should return only GM.dummyApi', async () => {
		const astNode = await parseCode(`GM.dummyApi`);
		const result = collectGrants(astNode);

		expect(result.size).toBe(1);
		expect(result).toContain('GM.dummyApi');
	});

	it('should return unsafeWindow when presented with just unsafeWindow', async () => {
		const astNode = await parseCode(`unsafeWindow`);
		const result = collectGrants(astNode);

		expect(result.size).toBe(1);
		expect(result).toContain('unsafeWindow');
	});

	it('should return nothing unsafeWindow when presented with unsafeWindowButNotReally', async () => {
		const astNode = await parseCode(`unsafeWindowButNotReally`);
		const result = collectGrants(astNode);

		expect(result.size).toBe(0);
	});

	it('should return unsafeWindow even when a subfield is accessed', async () => {
		const astNode = await parseCode(`unsafeWindow.anotherThing`);
		const result = collectGrants(astNode);

		expect(result.size).toBe(1);
		expect(result).toContain('unsafeWindow');
	});

	it('should return unsafeWindow even when a subfield is accessed with object notation', async () => {
		const astNode = await parseCode(`unsafeWindow["anotherThing"]`);
		const result = collectGrants(astNode);

		expect(result.size).toBe(1);
		expect(result).toContain('unsafeWindow');
	});
});

describe('getMetadata', () => {
	it('should throw error on an empty input', () => {
		expect(() => getMetadata('', new Set())).toThrow(Error);
	});

	it('should return a valid metadata block for a single file', () => {
		const input = `// ==UserScript==
// @name TestScript
// @version 1.0
// ==/UserScript==`;
		const result = getMetadata(input, new Set());
		expect(result).toContain('// ==UserScript==');
		expect(result).toContain('// @name    TestScript');
		expect(result).toContain('// @version 1.0');
		expect(result).toContain('// ==/UserScript==');
	});

	it('should merge entries from multiple files', () => {
		const file1 = `// ==UserScript==
// @name TestScript
// @version 1.0
// ==/UserScript==`;
		const file2 = `// ==UserScript==
// @match https://example.com/*
// @grant GM_getValue
// ==/UserScript==`;
		const result = getMetadata([file1, file2], new Set());
		// maxKeyWidth = 8 (@version)
		expect(result).toContain('// @name    TestScript');
		expect(result).toContain('// @version 1.0');
		expect(result).toContain('// @match   https://example.com/*');
		expect(result).toContain('// @grant   GM_getValue');
	});

	it('should let first file win on duplicate keys', () => {
		const file1 = `// ==UserScript==
// @name First
// @version 1.0
// ==/UserScript==`;
		const file2 = `// ==UserScript==
// @name Second
// @version 2.0
// ==/UserScript==`;
		const result = getMetadata([file1, file2], new Set());
		// maxKeyWidth = 8 (@version)
		expect(result).toContain('// @name    First');
		expect(result).toContain('// @version 1.0');
		expect(result).not.toContain('Second');
		expect(result).not.toContain('2.0');
	});

	it('should merge grants from multiple files', () => {
		const file1 = `// ==UserScript==
// @name TestScript
// @grant GM_setValue
// ==/UserScript==`;
		const file2 = `// ==UserScript==
// @match https://example.com/*
// @grant GM_getValue
// ==/UserScript==`;
		const result = getMetadata([file1, file2], new Set());
		// maxKeyWidth = 6 (@match, @grant)
		expect(result).toContain('// @grant GM_getValue');
		expect(result).toContain('// @grant GM_setValue');
	});

	it('should add auto-detected grants', () => {
		const input = `// ==UserScript==
// @name TestScript
// ==/UserScript==`;
		const result = getMetadata(input, new Set(['GM_xmlhttpRequest']));
		// maxKeyWidth = 6 (@grant)
		expect(result).toContain('// @grant GM_xmlhttpRequest');
	});

	it('should not duplicate grants already in the metadata files', () => {
		const input = `// ==UserScript==
// @name TestScript
// @grant GM_getValue
// ==/UserScript==`;
		const result = getMetadata(input, new Set(['GM_getValue']));
		const matches = result.match(/@grant\s+GM_getValue/g);
		expect(matches).toHaveLength(1);
	});

	it('should sort grants alphabetically', () => {
		const file1 = `// ==UserScript==
// @name TestScript
// @grant GM_setValue
// @grant GM_addStyle
// ==/UserScript==`;
		const file2 = `// ==UserScript==
// @match https://example.com/*
// @grant GM_getValue
// ==/UserScript==`;
		const result = getMetadata([file1, file2], new Set());
		const grantLines = result.split('\n').filter((l) => l.includes('@grant'));
		// maxKeyWidth = 6 (@match, @grant)
		expect(grantLines).toEqual([
			'// @grant GM_addStyle',
			'// @grant GM_getValue',
			'// @grant GM_setValue',
		]);
	});
});
