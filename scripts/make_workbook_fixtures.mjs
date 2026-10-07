/**
 * Write the three workbooks the readers are tested against: tests/fixtures/workbook_*.
 *
 * Run deliberately, from the repository root, after `npm install` in web/:
 *
 *     node scripts/make_workbook_fixtures.mjs
 *
 * Every one holds the same synthetic table - three made-up points - in a form
 * a reader chosen by file extension gets wrong:
 *
 *   workbook_default_password.xlsx   encrypted as Office encrypts when nobody
 *                                    set a password, with its own default one;
 *                                    Excel opens it without asking
 *   workbook_own_password.xlsx       the same with a password of its owner's,
 *                                    which nothing here may open
 *   workbook_legacy_named.xlsx       a legacy BIFF .xls under the name .xlsx
 *
 * The encryption is ECMA-376 Standard Encryption ([MS-OFFCRYPTO] 2.3.4), the
 * scheme the readers implement (geocoord/officecrypt.py, officecrypt.js),
 * written here with Node's own SHA-1 and AES so that the fixture and the code
 * it tests do not share an implementation. The salt and the verifier are
 * fixed, so the files come out the same every time.
 */
import crypto from 'node:crypto'
import { writeFileSync } from 'node:fs'
import * as XLSX from '../web/node_modules/xlsx/xlsx.mjs'

const OUT = new URL('../tests/fixtures/', import.meta.url)

const book = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ['Ponto', 'Latitude', 'Longitude'],
  ['A-1', 38.7, -9.1],
  ['A-2', 38.8, -9.2],
  ['A-3', 38.6, -9.0],
]), 'pontos')
const plain = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))

const sha1 = (...parts) => crypto.createHash('sha1').update(Buffer.concat(parts)).digest()
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const ecb = (key, data) => {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(data), cipher.final()])
}
const blocks = (data) => Buffer.concat([data, Buffer.alloc((16 - (data.length % 16)) % 16)])

function encrypted(password) {
  const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
  let h = sha1(salt, Buffer.from(password, 'utf16le'))
  for (let i = 0; i < 50000; i += 1) h = sha1(u32(i), h)
  h = sha1(h, u32(0))
  const pad = Buffer.alloc(64, 0x36)
  for (let i = 0; i < h.length; i += 1) pad[i] ^= h[i]
  const key = sha1(pad).subarray(0, 16)

  const verifier = Buffer.from('101112131415161718191a1b1c1d1e1f', 'hex')
  const provider = Buffer.from('Microsoft Enhanced RSA and AES Cryptographic Provider\0', 'utf16le')
  const header = Buffer.concat([
    u32(0x24), u32(0), u32(0x660e), u32(0x8004), u32(128), u32(0x18), u32(0), u32(0), provider,
  ])
  const info = Buffer.concat([
    Buffer.from([4, 0, 2, 0]), u32(0x24), u32(header.length), header,
    u32(16), salt, ecb(key, verifier), u32(20), ecb(key, blocks(sha1(verifier))),
  ])
  const size = Buffer.alloc(8)
  size.writeBigUInt64LE(BigInt(plain.length))
  const cfb = XLSX.CFB.utils.cfb_new()
  XLSX.CFB.utils.cfb_add(cfb, '/EncryptionInfo', info)
  XLSX.CFB.utils.cfb_add(cfb, '/EncryptedPackage', Buffer.concat([size, ecb(key, blocks(plain))]))
  return XLSX.CFB.write(cfb, { type: 'buffer' })
}

const files = {
  'workbook_default_password.xlsx': encrypted('VelvetSweatshop'),
  'workbook_own_password.xlsx': encrypted('segredo'),
  'workbook_legacy_named.xlsx': XLSX.write(book, { type: 'buffer', bookType: 'biff8' }),
}
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), bytes)
  console.log('wrote', name, bytes.length, 'bytes')
}
