import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist/main', { recursive: true, force: true });
await mkdir('dist/main', { recursive: true });
await cp('src/main', 'dist/main', { recursive: true });
