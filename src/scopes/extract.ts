import type {
	ArrayPattern,
	AssignmentPattern,
	BindingRestElement,
	MemberExpression,
	ObjectPattern,
} from "oxc-parser";
import type { Identifier } from "oxc-walker";

interface Patterns {
	ArrayPattern: ArrayPattern;
	AssignmentPattern: AssignmentPattern;
	Identifier: Identifier;
	MemberExpression: MemberExpression;
	ObjectPattern: ObjectPattern;
	BindingRestElement: BindingRestElement;
}
type KVRec<A> = {
	[KEY in keyof A]: (names: string[], param: (typeof A)[KEY]) => void;
};

type Extractors = KVRec<Patterns>;

const extractors: Extractors = {
	ArrayPattern(names: string[], param: ArrayPattern) {
		for (const element of param.elements) {
			if (element === null) continue;
			//@ts-expect-error: ok
			extractors[element.type]?.(names, element);
		}
	},

	AssignmentPattern(names: string[], param: AssignmentPattern) {
		extractors[param.left.type](names, param.left);
	},

	Identifier(names: string[], param: Identifier) {
		names.push(param.name);
	},

	MemberExpression() {},

	ObjectPattern(names: string[], param: ObjectPattern) {
		for (const prop of param.properties) {
			if (prop.type === "RestElement") {
				extractors.BindingRestElement(names, prop);
			} else {
				extractors[prop.value.type](names, prop.value);
			}
		}
	},

	BindingRestElement(names: string[], param: BindingRestElement) {
		extractors[param.argument.type](names, param.argument);
	},
};

export default function extractAssignedNames(param: Node): string[] {
	const names: string[] = [];

	//@ts-expect-error: ok
	extractors[param.type]?.(names, param);
	return names;
}
