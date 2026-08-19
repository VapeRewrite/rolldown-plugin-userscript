import type { MemberExpression, Node } from '@oxc-project/types';
import { walk } from 'oxc-walker';
import isReference from './is-reference.js';
import attachScopes, { type AttachedScope } from './scopes/attachScopes.js';

const META_START = '// ==UserScript==';
const META_END = '// ==/UserScript==';
const GRANTS_REGEXP = /^(unsafeWindow$|GM[._]\w+)/;

export function collectGrants(ast: Node): Set<string> {
	let scope = attachScopes(ast, 'scope');
	const grantSetPerFile = new Set<string>();
	walk(ast, {
		enter(nde: Node, parent) {
			const node = nde as Node & { scope: AttachedScope };
			if (node.scope) scope = node.scope;

			if (node.type === 'MemberExpression' && parent !== null && isReference(node, parent)) {
				const fullName = getMemberExpressionFullNameRecursive(node);
				if (fullName === null) return;
				const match = GRANTS_REGEXP.exec(fullName);
				if (match) {
					grantSetPerFile.add(match[0]);

					this.skip();
				}
			}

			if (
				node.type === 'Identifier' &&
				parent !== null &&
				isReference(node, parent) &&
				!scope.contains(node.name)
			) {
				const match = GRANTS_REGEXP.exec(node.name);
				if (match) {
					grantSetPerFile.add(match[0]);
				}
			}
		},
		leave(nde: Node) {
			const node = nde as Node & { scope: AttachedScope };

			// biome-ignore lint/style/noNonNullAssertion: ok
			if (node.scope) scope = scope.parent!;
		},
	});
	return grantSetPerFile;
}

function getMemberExpressionFullNameRecursive(astNode: MemberExpression): string | null {
	if (astNode.property.type !== 'Identifier') {
		return null;
	}

	switch (astNode.object.type) {
		case 'MemberExpression': {
			const nameSoFar = getMemberExpressionFullNameRecursive(astNode.object);
			if (nameSoFar == null) {
				return null;
			}

			return `${nameSoFar}.${astNode.property.name}`;
		}
		case 'Identifier': {
			return `${astNode.object.name}.${astNode.property.name}`;
		}
		default: {
			return null;
		}
	}
}

interface ParsedEntries {
	entries: [string, string][];
	grants: Set<string>;
}

function parseEntries(content: string): ParsedEntries {
	const lines = content.split('\n').map((line) => line.trim());
	const start = lines.indexOf(META_START);
	const end = lines.indexOf(META_END);
	if (start < 0 || end < 0) {
		throw new Error(
			'Invalid metadata block. For more details see https://violentmonkey.github.io/api/metadata-block/',
		);
	}
	const grants = new Set<string>();
	const entries: [string, string][] = [];
	for (const line of lines.slice(start + 1, end)) {
		if (!line.startsWith('// ')) continue;
		const trimmed = line.slice(3).trim();
		const matches = trimmed.match(/^(\S+)(\s.*)?$/);
		if (!matches) continue;
		const key = matches[1];
		const value = (matches[2] || '').trim();
		if (key === '@grant') {
			grants.add(value);
		} else {
			entries.push([key, value]);
		}
	}
	return { entries, grants };
}

function formatMetadata(entries: [string, string][]): string {
	const maxKeyWidth = Math.max(...entries.map(([key]) => key.length));
	return [
		META_START,
		...entries.map(([key, value]) => `// ${key.padEnd(maxKeyWidth)} ${value}`),
		META_END,
	].join('\n');
}

export function mergeMetadata(metaFileContents: string[]): string {
	const seen = new Set<string>();
	const mergedEntries: [string, string][] = [];
	const mergedGrants = new Set<string>();

	for (const content of metaFileContents) {
		const { entries, grants } = parseEntries(content);
		for (const [key, value] of entries) {
			if (seen.has(key)) continue;
			seen.add(key);
			mergedEntries.push([key, value]);
		}
		for (const grant of grants) {
			mergedGrants.add(grant);
		}
	}

	const sortedGrants = Array.from(mergedGrants).sort();
	for (const grant of sortedGrants) {
		mergedEntries.push(['@grant', grant]);
	}

	return formatMetadata(mergedEntries);
}

export function getMetadata(
	metaFileContent: string | string[],
	additionalGrantList: Set<string>,
): string {
	const contents = Array.isArray(metaFileContent) ? metaFileContent : [metaFileContent];

	const seen = new Set<string>();
	const mergedEntries: [string, string][] = [];
	const mergedGrants = new Set<string>();

	for (const content of contents) {
		const { entries, grants } = parseEntries(content);
		for (const [key, value] of entries) {
			if (seen.has(key)) continue;
			seen.add(key);
			mergedEntries.push([key, value]);
		}
		for (const grant of grants) {
			mergedGrants.add(grant);
		}
	}

	for (const grant of additionalGrantList) {
		mergedGrants.add(grant);
	}

	const sortedGrants = Array.from(mergedGrants).sort();
	for (const grant of sortedGrants) {
		mergedEntries.push(['@grant', grant]);
	}

	return formatMetadata(mergedEntries);
}
