// Writes the model to export/ as OBJ (+MTL) and GLB.
// Usage: npm run export [-- --no-context]
import { writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildHouse, DEFAULTS } from '../model/building.js';

// GLTFExporter reads Blobs through FileReader, which Node lacks.
globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
  async readAsDataURL(blob) {
    const b = Buffer.from(await blob.arrayBuffer()).toString('base64');
    this.result = `data:${blob.type || 'application/octet-stream'};base64,${b}`;
    this.onloadend?.();
  }
};

const context = !process.argv.includes('--no-context');
const out = new URL('../export/', import.meta.url);
mkdirSync(out, { recursive: true });
const base = context ? '7824-zero-rd' : '7824-zero-rd-building';

const root = buildHouse(DEFAULTS, { context });
root.updateMatrixWorld(true);

// OBJ in feet, Y up.
const mats = new Map();
root.traverse(o => { if (o.isMesh) mats.set(o.material.name, o.material); });
const obj = `# 7824 Zero Rd massing model. Units: feet. +X east, +Y up, +Z south.\nmtllib ${base}.mtl\n`
  + new OBJExporter().parse(root);
const mtl = [...mats.values()].map(m => {
  const c = m.color;
  return `newmtl ${m.name}\nKd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}\nKa 0 0 0\nKs 0.05 0.05 0.05\nd 1\nillum 2\n`;
}).join('\n');
writeFileSync(new URL(`${base}.obj`, out), obj);
writeFileSync(new URL(`${base}.mtl`, out), mtl);

// GLB in metres (glTF convention).
const scaled = new THREE.Group();
scaled.scale.setScalar(0.3048);
scaled.add(root);
const glb = await new GLTFExporter().parseAsync(scaled, { binary: true });
writeFileSync(new URL(`${base}.glb`, out), Buffer.from(glb));

console.log(`wrote export/${base}.obj, .mtl, .glb (${mats.size} materials)`);
