'use strict';

// Genuine Word 97–2003 .doc: MS-DOC text/piece/formatting tables in an MS-CFB
// container. Only local text is stored: no macros, fields, embedded objects or
// external relationships. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/
const { inflateRawSync } = require('node:zlib');

// Default A4, 12pt Times New Roman / SimSun styles from our blank Word document.
// Only the FIB, styles, fonts, paragraph/character and section defaults remain;
// author/revision lists, document properties, themes and timestamps are excluded.
const template = JSON.parse(inflateRawSync(Buffer.from('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', 'base64')).toString());
const defaults = Object.fromEntries(Object.entries(template).map(([name, value]) => [name, Buffer.from(value, 'base64')]));
const FREE = 0xffffffff, END = 0xfffffffe, FAT = 0xfffffffd;
const SECTOR = 512;

function compoundDocument(word, table) {
  let count = 1; // The first sector holds the three directory entries.
  const entries = [['WordDocument', word], ['1Table', table]].map(([name, content]) => {
    // Regular streams of at least 4096 bytes avoid a separate MiniFAT.
    const size = Math.max(4096, content.length), sectors = Math.ceil(size / SECTOR);
    const entry = { name, content, size, sectors, start: count };
    count += sectors;
    return entry;
  });
  let fats = 1;
  while (fats * 128 < count + fats) fats++;
  if (fats > 109) throw new RangeError('Word 报告超出可导出的文件大小');
  const output = Buffer.alloc((count + fats + 1) * SECTOR);
  const header = output.subarray(0, SECTOR);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header);
  header.writeUInt16LE(0x3e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(fats, 44);
  header.writeUInt32LE(0, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(END, 60);
  header.writeUInt32LE(END, 68);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < fats ? count + i : FREE, 76 + i * 4);
  const directory = output.subarray(SECTOR, 2 * SECTOR);
  function entry(index, name, type, start, size, left = FREE, child = FREE, color = 1) {
    const record = directory.subarray(index * 128, (index + 1) * 128);
    Buffer.from(name + '\0', 'utf16le').copy(record);
    record.writeUInt16LE((name.length + 1) * 2, 64);
    record[66] = type; record[67] = color;
    record.writeUInt32LE(left, 68);
    record.writeUInt32LE(FREE, 72);
    record.writeUInt32LE(child, 76);
    record.writeUInt32LE(start, 116);
    record.writeUInt32LE(size, 120);
  }
  // CFB directory ordering compares name lengths, then uppercase characters.
  entry(0, 'Root Entry', 5, END, 0, FREE, 1);
  entry(1, 'WordDocument', 2, entries[0].start, entries[0].size, 2);
  entry(2, '1Table', 2, entries[1].start, entries[1].size, FREE, FREE, 0);
  const fat = output.subarray((count + 1) * SECTOR);
  fat.fill(0xff);
  fat.writeUInt32LE(END, 0);
  for (const stream of entries) {
    stream.content.copy(output, (stream.start + 1) * SECTOR);
    for (let i = 0; i < stream.sectors; i++) {
      fat.writeUInt32LE(i === stream.sectors - 1 ? END : stream.start + i + 1, (stream.start + i) * 4);
    }
  }
  for (let i = 0; i < fats; i++) fat.writeUInt32LE(FAT, (count + i) * 4);
  return output;
}

function encodeWordDocument(text) {
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const body = Buffer.from(clean.replace(/\n/g, '\r').replace(/\r*$/, '\r'), 'utf16le');
  const start = 2048, end = start + body.length;
  const chpPage = Math.ceil(end / SECTOR), papPage = chpPage + 1, sepPage = papPage + 1;
  const word = Buffer.alloc((sepPage + 1) * SECTOR);
  defaults.fib.copy(word);
  body.copy(word, start);
  word.writeUInt32LE(start, 24); word.writeUInt32LE(end, 28);
  word.writeUInt32LE(word.length, 64); word.writeUInt32LE(body.length / 2, 76);
  const pairs = word.readUInt16LE(152);
  word.fill(0, 154, 154 + pairs * 8);
  const parts = []; let length = 0;
  function part(index, data) {
    word.writeUInt32LE(length, 154 + index * 8);
    word.writeUInt32LE(data.length, 158 + index * 8);
    parts.push(data); length += data.length;
  }
  part(1, defaults.styles);
  part(15, defaults.fonts);
  part(31, defaults.dop);
  for (const [index, page, name, boxSize] of [[12, chpPage, 'chpx', 1], [13, papPage, 'papx', 13]]) {
    const original = defaults[name], runs = original[511];
    const fkp = Buffer.alloc(SECTOR);
    fkp.writeUInt32LE(start, 0); fkp.writeUInt32LE(end, 4); fkp[511] = 1;
    original.subarray((runs + 1) * 4, (runs + 1) * 4 + boxSize).copy(fkp, 8);
    const properties = fkp[8] * 2;
    original.subarray(properties, 511).copy(fkp, properties);
    fkp.copy(word, page * SECTOR);
    const plc = Buffer.alloc(12);
    plc.writeUInt32LE(start, 0); plc.writeUInt32LE(end, 4); plc.writeUInt32LE(page, 8);
    part(index, plc);
  }
  defaults.sepx.copy(word, sepPage * SECTOR);
  const sections = Buffer.from(defaults.sections);
  sections.writeUInt32LE(body.length / 2, 4);
  sections.writeUInt32LE(sepPage * SECTOR, 10);
  part(6, sections);
  const clx = Buffer.alloc(21);
  clx[0] = 2; clx.writeUInt32LE(16, 1);
  clx.writeUInt32LE(body.length / 2, 9); clx.writeUInt32LE(start, 15);
  part(33, clx);
  return compoundDocument(word, Buffer.concat(parts));
}

module.exports = { encodeWordDocument };
