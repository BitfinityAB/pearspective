// Packs PNG files into one .ico (PNG-compressed entries, supported by every current browser).
import { readFileSync, writeFileSync } from 'node:fs';

const [output, ...inputs] = process.argv.slice(2);
const images = inputs.map((path) => {
  const data = readFileSync(path);
  return { data, width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
});
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ data, width, height }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});
writeFileSync(output, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
