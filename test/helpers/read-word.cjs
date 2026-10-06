'use strict';

// Independent reader for the exported CFB streams and MS-DOC piece table.
const assert = require('node:assert/strict');
function readWord(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
  assert.equal(buffer.readUInt16LE(26), 3);
  const size = 1 << buffer.readUInt16LE(30);
  const sector = id => buffer.subarray((id + 1) * size, (id + 2) * size);
  const fat = Buffer.concat(Array.from({ length: buffer.readUInt32LE(44) }, (_, i) => sector(buffer.readUInt32LE(76 + i * 4))));
  function chain(first) {
    const visited = new Set(), blocks = [];
    for (let id = first; id < 0xfffffffa; id = fat.readUInt32LE(id * 4)) {
      assert.ok((id + 2) * size <= buffer.length, 'stream sector must exist');
      assert.ok(!visited.has(id), 'stream chain must terminate without a cycle');
      visited.add(id); blocks.push(sector(id));
    }
    return Buffer.concat(blocks);
  }
  const directory = chain(buffer.readUInt32LE(48)), streams = {};
  for (let off = 128; off < directory.length; off += 128) {
    const record = directory.subarray(off, off + 128);
    if (record[66] !== 2) continue;
    const name = record.subarray(0, record.readUInt16LE(64) - 2).toString('utf16le');
    const length = record.readUInt32LE(120);
    assert.ok(length >= 4096, 'export uses regular streams');
    streams[name] = chain(record.readUInt32LE(116)).subarray(0, length);
  }
  const word = streams.WordDocument;
  assert.equal(word.readUInt16LE(0), 0xa5ec);
  assert.equal(word.readUInt16LE(10) & 0x8100, 0, 'no encryption or obfuscation');
  const table = streams[word.readUInt16LE(10) & 0x200 ? '1Table' : '0Table'];
  const clx = table.subarray(word.readUInt32LE(418), word.readUInt32LE(418) + word.readUInt32LE(422));
  assert.equal(clx[0], 2);
  const plc = clx.subarray(5, 5 + clx.readUInt32LE(1));
  const pieces = (plc.length - 4) / 12;
  const text = [];
  for (let i = 0; i < pieces; i++) {
    const count = plc.readUInt32LE((i + 1) * 4) - plc.readUInt32LE(i * 4);
    const fc = plc.readUInt32LE((pieces + 1) * 4 + i * 8 + 2);
    assert.equal(fc & 0x40000000, 0, 'text is stored as Unicode');
    text.push(word.subarray(fc, fc + count * 2).toString('utf16le'));
  }
  const content = text.join('');
  assert.equal(content.length, word.readUInt32LE(76));
  assert.ok(content.endsWith('\r'), 'main document must end with a paragraph');
  return { content, streams };
}
module.exports = { readWord };
