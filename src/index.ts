import { readFile } from 'node:fs/promises';
import type { Plugin } from 'rolldown';
import { withFilter } from 'rolldown/filter';
import { collectGrants, getMetadata } from './util.js';

const suffix = '?userscript-metadata';

type TransformFn = (metadata: string) => string;

export interface UserscriptMetaOptions {
	transform?: TransformFn;
	ignoreAutomaticGrants?: string[];
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
				order: 'post',
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

					let metadata = getMetadata(metadataContents, grantSet);
					if (userOptions?.transform) metadata = userOptions.transform(metadata);
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
