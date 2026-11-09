import { describe, expect, it } from 'bun:test';
import userscript from '../src/index.js';
import { rolldown } from 'rolldown';

describe('rolldown-plugin-userscript', () => {
	it('should return "userscript-metadata" as the plugin name', () => {
		expect(userscript().name).toBe('userscript-metadata');
	});
	it('should work with minification with metadataExperiment', async () => {
		const rd = await rolldown({
			input: import.meta.resolve("./test-src"),
			cwd: import.meta.dir,
			plugins: [
				userscript({
					metadataExperiment: true
				})
			]
		});
		const out = await rd.generate({
			minify: true,
			format: "iife"
		});
		const chunk = out.output[0];
		console.log(chunk.code);
		expect(chunk.code).toInclude("// ");
	});
});
