import { readFile } from 'node:fs/promises';
import type { Plugin } from 'rolldown';
import { withFilter } from 'rolldown/filter';
import { collectGrants, getMetadata } from './util.js';

const suffix = '?userscript-metadata';

type TransformFn = (metadata: string) => string;

export interface UserscriptMetaOptions {
	transform?: TransformFn;
	ignoreAutomaticGrants?: string[];
	/**
	 * An experimental option to wrap the userscript's metadata in a template literal.
	 * This *should* allow the plugin to be used easily
	 * without immediately being broken by a minifier.
	 * This has been tested and works on TamperMonkey and ViolentMonkey,
	 * so it should work for most of your users.
	 * "\`" characters probably won't work with this, but I'm too lazy to do that.
	 * Before:
	 * ```js
	 * // ==UserScript==
	 * // @name        Test script
	 * // ...
	 * // ==/UserScript==
	 * console.log("hello")
	 * ```
	 * After:
	 * ```js
	 * _=`// ==UserScript==
	 * // @name        Test script
	 * // ...
	 * // ==/UserScript==`;
	 * console.log("hello")
	 * ```
	 * It's no magic, it just wraps your metadata in a template literal and assigns it.
	 * Note that this WILL make top-level `"use strict"` directives effectively invalid,
	 * since your actual code gets pushed down a few lines.
	 * it may cause some quirks if you try to access a variable named `_` before its initialized,
	 * but no one cares, so I don't bother with that.
	 * @default false
	 */
	metadataExperiment?: boolean;
}

type TransformOrUserOpt = TransformFn | UserscriptMetaOptions;

function userscriptPlugin(transformOrUserOptions?: TransformOrUserOpt): Plugin {
	const userOptions =
		typeof transformOrUserOptions === 'function'
			? { transform: transformOrUserOptions }
			: transformOrUserOptions;

	const metadataFiles = new Set<string>();
	const importersOfMetadata = new Set<string>();
	const grantMap = new Map();
	return withFilter(
		{
			name: 'userscript-metadata',
			async resolveId(source, importer, options) {
				if (source.endsWith(suffix)) {
					const resolved = await this.resolve(source, importer, options);
					if (resolved === null) return source;
					let { id } = resolved;
					if (id.endsWith(suffix)) id = id.slice(0, -suffix.length);
					metadataFiles.add(id);
					if (importer) importersOfMetadata.add(importer);
					return source;
				}
			},
			load(id) {
				if (id.endsWith(suffix)) {
					return '';
				}
			},
			transform: {
				filter: {
					id: /\.[cm]?[jt]sx?$/,
				},
				order: 'post',
				handler(code, id, meta) {
					const ast =
						meta.ast ??
						this.parse(code, {
							lang: id.endsWith('.ts') || id.endsWith('.tsx') ? 'ts' : 'js',
						});
					const grantSetPerFile = collectGrants(ast);
					grantMap.set(id, grantSetPerFile);
				},
			},

			banner: {
				order: 'pre',
				async handler(chunk) {
					if (!chunk.isEntry) return;

					const chunkModuleIds = [
						...(chunk.facadeModuleId ? [chunk.facadeModuleId] : []),
						...Object.keys(chunk.modules),
					];

					const chunkHasMetadata = chunkModuleIds.some((id) => importersOfMetadata.has(id));

					if (!chunkHasMetadata) return;

					const metadataContents: string[] = await Promise.all(
						[...metadataFiles].map((file) => readFile(file, 'utf8')),
					);

					const grantSet = new Set<string>();
					for (const id of this.getModuleIds()) {
						const grantSetPerFile = grantMap.get(id);
						if (grantSetPerFile) {
							for (const item of grantSetPerFile) {
								if (userOptions?.ignoreAutomaticGrants?.includes(item)) {
									continue;
								}

								grantSet.add(item);
							}
						}
					}

					const transform = userOptions?.transform ?? ((s) => s);
					const metadata = transform(getMetadata(metadataContents, grantSet));
					// TODO: properly escape the metadata string thing
					// TODO: `"use strict"` only works if its on top of the script,
					//		 this breaks it by putting it many lines below.
					//		 but no one cares lol
					if (userOptions?.metadataExperiment) {
						return `_=\`${metadata}\`;`;
					}
					return metadata;
				},
			},
		},
		{
			load: { id: /\?userscript-metadata$/ },
			resolveId: { id: /\?userscript-metadata$/ },
		},
	);
}

export default userscriptPlugin;
