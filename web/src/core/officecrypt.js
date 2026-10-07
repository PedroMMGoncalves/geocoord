/**
 * Workbooks that Office encrypted with its own default password.
 *
 * A workbook saved with some kinds of protection is written encrypted even
 * when nobody was asked for a password: Office uses one of its own,
 * `VelvetSweatshop`, which Microsoft documents, and Excel tries it silently on
 * opening. To Excel such a file is an ordinary workbook. To a library it is an
 * OLE2 container holding an `EncryptedPackage`, and reading it fails with
 * "File is password-protected" although it is published for anyone to open.
 * The national list of geodetic marks for the Azores is such a file.
 *
 * This opens them, and only them: the default password is tried, and a
 * workbook its owner gave a password of their own stays closed, with
 * WorkbookProtected to say so. Nothing here guesses at a password.
 *
 * What is implemented is ECMA-376 Standard Encryption (the scheme of Office
 * 2007: SHA-1, AES in ECB mode; [MS-OFFCRYPTO] 2.3.4.5 to 2.3.4.9). The Agile
 * scheme of later versions is reported as protected. SHA-1 and AES are written
 * out here: the browser's own are asynchronous and offer no ECB, and fifty
 * thousand awaited hashes is seconds where this is milliseconds. Mirrors
 * geocoord/officecrypt.py.
 */

/** The password Office uses when it encrypts without being given one. */
export const DEFAULT_PASSWORD = 'VelvetSweatshop'

/** How an OLE2 compound file starts: a legacy .xls, or an encrypted workbook. */
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

const AES_KEY_BITS = { 0x660e: 128, 0x660f: 192, 0x6610: 256 }
const SHA1 = 0x8004
const SPIN = 50000

/**
 * A workbook encrypted with a password of its owner's, or in a scheme this
 * does not read. `code` lets the interface say what to do about it.
 */
export class WorkbookProtected extends Error {
  constructor(message = 'protected by a password') {
    super(message)
    this.name = 'WorkbookProtected'
    this.code = 'protected'
  }
}

export function isOle2(bytes) {
  return OLE2.every((b, i) => bytes[i] === b)
}

/**
 * The workbook inside an encrypted container, or null.
 *
 * Null means `bytes` is not an encrypted workbook at all - a legacy .xls, or
 * not an OLE2 file - and should be read as it is. A Uint8Array is the
 * decrypted .xlsx. WorkbookProtected is thrown when it is encrypted and the
 * default password does not open it. `CFB` is SheetJS's container reader.
 */
export function openPackage(bytes, CFB) {
  if (!isOle2(bytes)) return null
  let info
  let pkg
  try {
    const cfb = CFB.read(bytes, { type: 'array' })
    info = CFB.find(cfb, 'EncryptionInfo')?.content
    pkg = CFB.find(cfb, 'EncryptedPackage')?.content
  } catch {
    return null // not a container that can be walked: let the reader say so
  }
  if (!info || !pkg) return null
  info = Uint8Array.from(info)
  pkg = Uint8Array.from(pkg)

  const view = new DataView(info.buffer)
  const major = view.getUint16(0, true)
  const minor = view.getUint16(2, true)
  if (minor !== 2 || ![2, 3, 4].includes(major)) {
    throw new WorkbookProtected('encrypted in a scheme that is not read here')
  }
  const headerSize = view.getUint32(8, true)
  const algorithm = view.getUint32(20, true)
  const hashAlgorithm = view.getUint32(24, true)
  const keyBits = view.getUint32(28, true)
  if (AES_KEY_BITS[algorithm] !== keyBits || hashAlgorithm !== SHA1) {
    throw new WorkbookProtected('encrypted in a scheme that is not read here')
  }
  const verifier = 12 + headerSize
  const saltSize = view.getUint32(verifier, true)
  const salt = info.subarray(verifier + 4, verifier + 4 + saltSize)
  const encryptedVerifier = info.subarray(verifier + 4 + saltSize, verifier + 20 + saltSize)
  const hashSize = view.getUint32(verifier + 20 + saltSize, true)
  const encryptedHash = info.subarray(verifier + 24 + saltSize, verifier + 56 + saltSize)

  const key = deriveKey(DEFAULT_PASSWORD, salt, keyBits / 8)
  const check = sha1(aesEcbDecrypt(key, encryptedVerifier))
  const stored = aesEcbDecrypt(key, encryptedHash)
  for (let i = 0; i < hashSize; i += 1) {
    if (check[i] !== stored[i]) throw new WorkbookProtected()
  }

  const sizes = new DataView(pkg.buffer, pkg.byteOffset, 8)
  const size = sizes.getUint32(0, true) + sizes.getUint32(4, true) * 0x100000000
  const body = pkg.subarray(8, 8 + Math.ceil(size / 16) * 16)
  return aesEcbDecrypt(key, body).subarray(0, size)
}

/** [MS-OFFCRYPTO] 2.3.4.7: the key from a password, for Standard Encryption. */
function deriveKey(password, salt, length) {
  const first = new Uint8Array(salt.length + password.length * 2)
  first.set(salt)
  for (let i = 0; i < password.length; i += 1) {
    const unit = password.charCodeAt(i)
    first[salt.length + 2 * i] = unit & 0xff
    first[salt.length + 2 * i + 1] = unit >>> 8
  }
  let digest = sha1(first)
  const step = new Uint8Array(24)
  const counter = new DataView(step.buffer)
  for (let i = 0; i < SPIN; i += 1) {
    counter.setUint32(0, i, true)
    step.set(digest, 4)
    digest = sha1(step)
  }
  const last = new Uint8Array(24)
  last.set(digest)
  digest = sha1(last)
  const pad = (byte) => {
    const block = new Uint8Array(64).fill(byte)
    for (let i = 0; i < digest.length; i += 1) block[i] ^= digest[i]
    return sha1(block)
  }
  const both = new Uint8Array(40)
  both.set(pad(0x36))
  both.set(pad(0x5c), 20)
  return both.subarray(0, length)
}

// ---------------------------------------------------------------------------
// SHA-1 (FIPS 180-4)
// ---------------------------------------------------------------------------
export function sha1(bytes) {
  const padded = new Uint8Array((((bytes.length + 8) >> 6) << 6) + 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(o + 4 * i)
    for (let i = 16; i < 80; i += 1) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = (x << 1) | (x >>> 31)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i += 1) {
      let f
      let k
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999 } else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 } else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc } else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = t
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }
  const out = new Uint8Array(20)
  const result = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => result.setUint32(4 * i, h >>> 0))
  return out
}

// ---------------------------------------------------------------------------
// AES (FIPS 197), decryption only
// ---------------------------------------------------------------------------
/** The S-box, computed rather than typed, and the tables that follow from it. */
function tables() {
  const sbox = new Uint8Array(256)
  let p = 1
  let q = 1
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff // p times 3
    q ^= (q << 1) & 0xff // q divided by 3
    q ^= (q << 2) & 0xff
    q ^= (q << 4) & 0xff
    if (q & 0x80) q ^= 0x09
    let x = q
    for (const shift of [1, 2, 3, 4]) x ^= ((q << shift) | (q >> (8 - shift))) & 0xff
    sbox[p] = x ^ 0x63
  } while (p !== 1)
  sbox[0] = 0x63
  const inverse = new Uint8Array(256)
  sbox.forEach((v, i) => { inverse[v] = i })

  const times = (a, b) => {
    let out = 0
    let x = a
    for (let y = b; y; y >>= 1) {
      if (y & 1) out ^= x
      x = ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff
    }
    return out
  }
  const multiples = (k) => Uint8Array.from({ length: 256 }, (_, i) => times(i, k))
  return { sbox, inverse, m9: multiples(9), m11: multiples(11), m13: multiples(13), m14: multiples(14) }
}

const T = tables()

// The state is sixteen bytes in column order. Undoing ShiftRows moves row r
// of the state r columns to the right.
const UNSHIFT = Uint8Array.from({ length: 16 }, (_, i) => 4 * ((((i >> 2) - (i & 3)) + 4) % 4) + (i & 3))

function roundKeys(key) {
  const words = key.length / 4
  const rounds = words + 6
  const w = []
  for (let i = 0; i < words; i += 1) w.push(Array.from(key.subarray(4 * i, 4 * i + 4)))
  let rcon = 1
  for (let i = words; i < 4 * (rounds + 1); i += 1) {
    let t = [...w[i - 1]]
    if (i % words === 0) {
      t = [t[1], t[2], t[3], t[0]].map((b) => T.sbox[b])
      t[0] ^= rcon
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff
    } else if (words > 6 && i % words === 4) {
      t = t.map((b) => T.sbox[b])
    }
    w.push(w[i - words].map((b, k) => b ^ t[k]))
  }
  return Array.from({ length: rounds + 1 }, (_, r) => Uint8Array.from(w.slice(4 * r, 4 * r + 4).flat()))
}

/** AES in ECB mode. `data` is a whole number of sixteen-byte blocks. */
export function aesEcbDecrypt(key, data) {
  const keys = roundKeys(key)
  const rounds = keys.length - 1
  const out = new Uint8Array(data.length)
  const s = new Uint8Array(16)
  const t = new Uint8Array(16)
  for (let o = 0; o + 16 <= data.length; o += 16) {
    for (let i = 0; i < 16; i += 1) s[i] = data[o + i] ^ keys[rounds][i]
    for (let r = rounds - 1; r >= 1; r -= 1) {
      for (let i = 0; i < 16; i += 1) t[i] = T.inverse[s[UNSHIFT[i]]] ^ keys[r][i]
      for (let c = 0; c < 16; c += 4) {
        const [a0, a1, a2, a3] = [t[c], t[c + 1], t[c + 2], t[c + 3]]
        s[c] = T.m14[a0] ^ T.m11[a1] ^ T.m13[a2] ^ T.m9[a3]
        s[c + 1] = T.m9[a0] ^ T.m14[a1] ^ T.m11[a2] ^ T.m13[a3]
        s[c + 2] = T.m13[a0] ^ T.m9[a1] ^ T.m14[a2] ^ T.m11[a3]
        s[c + 3] = T.m11[a0] ^ T.m13[a1] ^ T.m9[a2] ^ T.m14[a3]
      }
    }
    for (let i = 0; i < 16; i += 1) out[o + i] = T.inverse[s[UNSHIFT[i]]] ^ keys[0][i]
  }
  return out
}
