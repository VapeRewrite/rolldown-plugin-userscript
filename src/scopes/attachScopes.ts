import type { BaseNode } from 'estree';
import type { Function as Fn, Node } from 'oxc-parser';
import { walk } from 'oxc-walker';
import extractAssignedNames from './extract.js';

interface BlockDeclaration {
	[index: string]: boolean;
}

const blockDeclarations: BlockDeclaration = {
	const: true,
	let: true,
};

export interface AttachedScope {
	parent?: AttachedScope;
	isBlockScope: boolean;
	declarations: { [key: string]: boolean };
	addDeclaration(node: BaseNode, isBlockDeclaration: boolean, isVar: boolean): void;
	contains(name: string): boolean;
}

interface ScopeOptions {
	parent?: AttachedScope;
	block?: boolean;
	params?: Node[];
}

class Scope implements AttachedScope {
	parent?: AttachedScope;
	isBlockScope: boolean;
	declarations: { [key: string]: boolean };

	constructor(options: ScopeOptions = {}) {
		this.parent = options.parent;
		this.isBlockScope = !!options.block;

		this.declarations = Object.create(null);

		if (options.params) {
			options.params.forEach((param) => {
				extractAssignedNames(param).forEach((name) => {
					this.declarations[name] = true;
				});
			});
		}
	}

	addDeclaration(node: Node, isBlockDeclaration: boolean, isVar: boolean): void {
		if (!isBlockDeclaration && this.isBlockScope) {
			// it's a `var` or function node, and this
			// is a block scope, so we need to go up
			this.parent.addDeclaration(node, isBlockDeclaration, isVar);
		} else if ((node as Node & { id?: BaseNode }).id) {
			extractAssignedNames((node as Node & { id: BaseNode }).id).forEach((name) => {
				this.declarations[name] = true;
			});
		}
	}

	contains(name: string): boolean {
		return this.declarations[name] || (this.parent ? this.parent.contains(name) : false);
	}
}

export default function attachScopes(ast: Node, propertyName = 'scope'): Scope {
	let scope = new Scope();

	walk(ast, {
		enter(n, parent) {
			const node = n as Node;
			// function foo () {...}
			// class Foo {...}
			if (/(?:Function|Class)Declaration/.test(node.type)) {
				scope.addDeclaration(node, false, false);
			}

			// var foo = 1
			if (node.type === 'VariableDeclaration') {
				const { kind } = node;
				const isBlockDeclaration = blockDeclarations[kind];
				node.declarations.forEach((declaration) => {
					scope.addDeclaration(declaration, isBlockDeclaration, true);
				});
			}

			let newScope: AttachedScope | undefined;

			// create new function scope
			if (node.type.includes('Function')) {
				const func = node as Fn;
				newScope = new Scope({
					parent: scope,
					block: false,
					params: func.params,
				});

				// named function expressions - the name is considered
				// part of the function's scope
				if (func.type === 'FunctionExpression' && func.id) {
					newScope.addDeclaration(func, false, false);
				}
			}

			// create new for scope
			if (/For(?:In|Of)?Statement/.test(node.type)) {
				newScope = new Scope({
					parent: scope,
					block: true,
				});
			}

			// create new block scope
			if (node.type === 'BlockStatement' && !parent.type.includes('Function')) {
				newScope = new Scope({
					parent: scope,
					block: true,
				});
			}

			// catch clause has its own block scope
			if (node.type === 'CatchClause') {
				newScope = new Scope({
					parent: scope,
					params: node.param ? [node.param] : [],
					block: true,
				});
			}

			if (newScope) {
				Object.defineProperty(node, propertyName, {
					value: newScope,
					configurable: true,
				});

				scope = newScope;
			}
		},
		leave(n) {
			const node = n as Node & Record<string, unknown>;
			if (node[propertyName]) scope = scope.parent;
		},
	});

	return scope;
}
