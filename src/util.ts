import type { MemberExpression, Node } from "@oxc-project/types";
import { walk } from "oxc-walker";
import isReference from "./is-reference.js";
import attachScopes, { type AttachedScope } from "./scopes/attachScopes.js";

const META_START = "// ==UserScript==";
const META_END = "// ==/UserScript==";
const GRANTS_REGEXP = /^(unsafeWindow$|GM[._]\w+)/;

export function collectGrants(ast: Node): Set<string> {
	let scope = attachScopes(ast, "scope");
	const grantSetPerFile = new Set<string>();
	walk(ast, {
		enter(nde: Node, parent) {
			const node = nde as Node & { scope: AttachedScope };
			if (node.scope) scope = node.scope;

			if (
				node.type === "MemberExpression" &&
				parent !== null &&
				isReference(node, parent)
			) {
				const fullName = getMemberExpressionFullNameRecursive(node);
				if (fullName === null) return;
				const match = GRANTS_REGEXP.exec(fullName);
				if (match) {
					grantSetPerFile.add(match[0]);

					this.skip();
				}
			}

			if (
				node.type === "Identifier" &&
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

function getMemberExpressionFullNameRecursive(
	astNode: MemberExpression,
): string | null {
	if (astNode.property.type !== "Identifier") {
		return null;
	}

	switch (astNode.object.type) {
		case "MemberExpression": {
			const nameSoFar = getMemberExpressionFullNameRecursive(
				astNode.object,
			);
			if (nameSoFar == null) {
				return null;
			}

			return `${nameSoFar}.${astNode.property.name}`;
		}
		case "Identifier": {
			return `${astNode.object.name}.${astNode.property.name}`;
		}
		default: {
			return null;
		}
	}
}

export function getMetadata(
	metaFileContent: string,
	additionalGrantList: Set<string>,
): string {
	const lines = metaFileContent.split("\n").map((line) => line.trim());
	const start = lines.indexOf(META_START);
	const end = lines.indexOf(META_END);
	if (start < 0 || end < 0) {
		throw new Error(
			"Invalid metadata block. For more details see https://violentmonkey.github.io/api/metadata-block/",
		);
	}
	const grantSet = new Set<string>();
	const entries = lines
		.slice(start + 1, end)
		.map((line) => {
			if (!line.startsWith("// ")) return undefined;
			line = line.slice(3).trim();
			const matches = line.match(/^(\S+)(\s.*)?$/);
			if (!matches) return undefined;
			const key = matches[1];
			const value = (matches[2] || "").trim();
			if (key === "@grant") {
				grantSet.add(value);
				return undefined;
			}
			return [key, value] as const;
		})
		.filter((x) => x !== undefined);
	for (const item of additionalGrantList) {
		grantSet.add(item);
	}
	const grantList = Array.from(grantSet);
	grantList.sort();
	for (const item of grantList) {
		entries.push(["@grant", item] as const);
	}
	const maxKeyWidth = Math.max(...entries.map(([key]) => key.length));
	return [
		META_START,
		...entries.map(
			([key, value]) => `// ${key.padEnd(maxKeyWidth)} ${value}`,
		),
		META_END,
	].join("\n");
}
