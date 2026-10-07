"""Workbooks that Office encrypted with its own default password.

A workbook saved with some kinds of protection is written encrypted even when
nobody was asked for a password: Office uses one of its own, ``VelvetSweatshop``,
which Microsoft documents, and Excel tries it silently on opening. To Excel such
a file is an ordinary workbook. To a library it is an OLE2 container holding an
``EncryptedPackage``, and reading it fails - "File is not a zip file" from one,
"File is password-protected" from another - although it is published for anyone
to open. The national list of geodetic marks for the Azores is such a file.

This opens them, and only them: the default password is tried, and a workbook
its owner gave a password of their own stays closed, with
:class:`WorkbookProtected` to say so. Nothing here guesses at a password.

What is implemented is ECMA-376 *Standard Encryption* (the scheme of Office
2007: SHA-1, AES in ECB mode; [MS-OFFCRYPTO] 2.3.4.5 to 2.3.4.9). The *Agile*
scheme of later versions is recognised and reported as protected. AES is
written out here, over numpy, because the standard library has none and one
dependency fewer is one fewer to carry into the installer. Mirrors
``web/src/core/officecrypt.js``.
"""
from __future__ import annotations

import hashlib
import io
import struct

import numpy as np
from xlrd import compdoc

#: How an OLE2 compound file starts: a legacy .xls, or an encrypted workbook.
OLE2 = bytes.fromhex("d0cf11e0a1b11ae1")

#: The password Office uses when it encrypts without being given one.
DEFAULT_PASSWORD = "VelvetSweatshop"

_AES_KEY_BITS = {0x660E: 128, 0x660F: 192, 0x6610: 256}
_SHA1 = 0x8004
_SPIN = 50000


class WorkbookProtected(Exception):
    """A workbook encrypted with a password of its owner's, or in a scheme
    this does not read. The interface says what to do about it."""


def open_package(data: bytes):
    """The workbook inside an encrypted container, or None.

    None means ``data`` is not an encrypted workbook at all - it is a legacy
    .xls, or not an OLE2 file - and should be read as it is. Bytes are the
    decrypted .xlsx. :class:`WorkbookProtected` is raised when it is encrypted
    and the default password does not open it.
    """
    if data[:8] != OLE2:
        return None
    try:
        doc = compdoc.CompDoc(data, logfile=io.StringIO())
        info = doc.get_named_stream("EncryptionInfo")
        package = doc.get_named_stream("EncryptedPackage")
    except Exception:  # not a container xlrd can walk: let the reader say so
        return None
    if info is None or package is None:
        return None

    major, minor = struct.unpack_from("<HH", info, 0)
    if minor != 2 or major not in (2, 3, 4):
        raise WorkbookProtected("encrypted in a scheme that is not read here")
    header_size = struct.unpack_from("<I", info, 8)[0]
    algorithm, hash_algorithm, key_bits = struct.unpack_from("<III", info, 12 + 8)
    if _AES_KEY_BITS.get(algorithm) != key_bits or hash_algorithm != _SHA1:
        raise WorkbookProtected("encrypted in a scheme that is not read here")
    verifier = 12 + header_size
    salt_size = struct.unpack_from("<I", info, verifier)[0]
    salt = info[verifier + 4:verifier + 4 + salt_size]
    encrypted_verifier = info[verifier + 4 + salt_size:verifier + 20 + salt_size]
    hash_size = struct.unpack_from("<I", info, verifier + 20 + salt_size)[0]
    encrypted_hash = info[verifier + 24 + salt_size:verifier + 56 + salt_size]

    key = _derive_key(DEFAULT_PASSWORD, salt, key_bits // 8)
    check = hashlib.sha1(aes_ecb_decrypt(key, encrypted_verifier)).digest()
    if check != aes_ecb_decrypt(key, encrypted_hash)[:hash_size]:
        raise WorkbookProtected("protected by a password")

    size = struct.unpack_from("<Q", package, 0)[0]
    body = package[8:8 + -(-size // 16) * 16]
    return aes_ecb_decrypt(key, body)[:size]


def _derive_key(password: str, salt: bytes, length: int) -> bytes:
    """[MS-OFFCRYPTO] 2.3.4.7: the key from a password, for Standard Encryption."""
    digest = hashlib.sha1(salt + password.encode("utf-16-le")).digest()
    for i in range(_SPIN):
        digest = hashlib.sha1(struct.pack("<I", i) + digest).digest()
    digest = hashlib.sha1(digest + struct.pack("<I", 0)).digest()
    inner = hashlib.sha1(bytes(b ^ 0x36 for b in digest.ljust(64, b"\0"))).digest()
    outer = hashlib.sha1(bytes(b ^ 0x5C for b in digest.ljust(64, b"\0"))).digest()
    return (inner + outer)[:length]


# ---------------------------------------------------------------------------
# AES (FIPS 197), decryption only
# ---------------------------------------------------------------------------
def _tables():
    """The S-box, computed rather than typed, and the tables that follow from it."""
    sbox = [0] * 256
    p = q = 1
    while True:
        p = (p ^ (p << 1) ^ (0x1B if p & 0x80 else 0)) & 0xFF      # p times 3
        q ^= (q << 1) & 0xFF                                       # q divided by 3
        q ^= (q << 2) & 0xFF
        q ^= (q << 4) & 0xFF
        if q & 0x80:
            q ^= 0x09
        x = q
        for shift in (1, 2, 3, 4):
            x ^= ((q << shift) | (q >> (8 - shift))) & 0xFF
        sbox[p] = x ^ 0x63
        if p == 1:
            break
    sbox[0] = 0x63
    inverse = [0] * 256
    for i, v in enumerate(sbox):
        inverse[v] = i

    def times(a, b):
        out = 0
        while b:
            if b & 1:
                out ^= a
            a = ((a << 1) ^ (0x1B if a & 0x80 else 0)) & 0xFF
            b >>= 1
        return out

    multiples = {k: np.array([times(i, k) for i in range(256)], dtype=np.uint8) for k in (9, 11, 13, 14)}
    return sbox, np.array(inverse, dtype=np.uint8), multiples


_SBOX, _INVERSE_SBOX, _TIMES = _tables()

# The state is sixteen bytes in column order. Undoing ShiftRows moves row r
# of the state r columns to the right.
_UNSHIFT = np.array([4 * ((c - r) % 4) + r for c in range(4) for r in range(4)])


def _round_keys(key: bytes) -> np.ndarray:
    words = len(key) // 4
    rounds = words + 6
    w = [list(key[4 * i:4 * i + 4]) for i in range(words)]
    rcon = 1
    for i in range(words, 4 * (rounds + 1)):
        t = list(w[i - 1])
        if i % words == 0:
            t = [_SBOX[b] for b in t[1:] + t[:1]]
            t[0] ^= rcon
            rcon = ((rcon << 1) ^ (0x1B if rcon & 0x80 else 0)) & 0xFF
        elif words > 6 and i % words == 4:
            t = [_SBOX[b] for b in t]
        w.append([a ^ b for a, b in zip(w[i - words], t)])
    return np.array(w, dtype=np.uint8).reshape(rounds + 1, 16)


def aes_ecb_decrypt(key: bytes, data: bytes) -> bytes:
    """AES in ECB mode, every block at once."""
    keys = _round_keys(key)
    state = np.frombuffer(data, dtype=np.uint8).reshape(-1, 16) ^ keys[-1]
    for round_key in keys[-2:0:-1]:
        state = _INVERSE_SBOX[state[:, _UNSHIFT]] ^ round_key
        a = state.reshape(-1, 4, 4)                      # columns of four bytes
        state = np.stack([
            _TIMES[14][a[:, :, 0]] ^ _TIMES[11][a[:, :, 1]] ^ _TIMES[13][a[:, :, 2]] ^ _TIMES[9][a[:, :, 3]],
            _TIMES[9][a[:, :, 0]] ^ _TIMES[14][a[:, :, 1]] ^ _TIMES[11][a[:, :, 2]] ^ _TIMES[13][a[:, :, 3]],
            _TIMES[13][a[:, :, 0]] ^ _TIMES[9][a[:, :, 1]] ^ _TIMES[14][a[:, :, 2]] ^ _TIMES[11][a[:, :, 3]],
            _TIMES[11][a[:, :, 0]] ^ _TIMES[13][a[:, :, 1]] ^ _TIMES[9][a[:, :, 2]] ^ _TIMES[14][a[:, :, 3]],
        ], axis=2).reshape(-1, 16)
    return (_INVERSE_SBOX[state[:, _UNSHIFT]] ^ keys[0]).tobytes()
