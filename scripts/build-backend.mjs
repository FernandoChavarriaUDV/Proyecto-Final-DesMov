import { build } from 'esbuild';
for (const name of ['register-face', 'recognize-face', 'delete-face']) {
  await build({ entryPoints: [`backend/lambdas/${name}/index.ts`], outfile: `dist/${name}/index.js`, bundle: true, platform: 'node', target: 'node24', format: 'cjs', sourcemap: false });
}
