"""The cipher under the workbooks Office encrypts with its default password.

What it opens, and what it must not, is tested through the reader
(tests/test_reader.py). Here the AES written out in geocoord/officecrypt.py is
held to the vectors FIPS 197 publishes, appendix C.
"""
import pytest

from geocoord import officecrypt

PLAIN = bytes.fromhex("00112233445566778899aabbccddeeff")


@pytest.mark.parametrize("key,cipher", [
    ("000102030405060708090a0b0c0d0e0f", "69c4e0d86a7b0430d8cdb78070b4c55a"),
    ("000102030405060708090a0b0c0d0e0f1011121314151617", "dda97ca4864cdfe06eaf70a0ec0d7191"),
    ("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
     "8ea2b7ca516745bfeafc49904b496089"),
], ids=["AES-128", "AES-192", "AES-256"])
def test_aes_decrypts_the_published_vectors(key, cipher):
    assert officecrypt.aes_ecb_decrypt(bytes.fromhex(key), bytes.fromhex(cipher)) == PLAIN


def test_aes_decrypts_every_block_on_its_own():
    cipher = bytes.fromhex("69c4e0d86a7b0430d8cdb78070b4c55a")
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    assert officecrypt.aes_ecb_decrypt(key, cipher * 3) == PLAIN * 3


def test_anything_that_is_not_an_encrypted_workbook_is_left_alone():
    assert officecrypt.open_package(b"PK\x03\x04 a zip") is None
    assert officecrypt.open_package(b"lat,lon\n1,2\n") is None
    # An OLE2 signature over nothing a container reader can walk.
    assert officecrypt.open_package(officecrypt.OLE2 + b"\0" * 64) is None
