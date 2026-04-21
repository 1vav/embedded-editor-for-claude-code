import { renderToPngBase64 } from '../src/render.js';
import fs from 'fs';
const diagram = JSON.parse(fs.readFileSync('architecture.excalidraw', 'utf8'));
const png = await renderToPngBase64(diagram);
fs.writeFileSync('architecture.png', Buffer.from(png, 'base64'));
console.log('PNG written:', Buffer.from(png, 'base64').length, 'bytes');
