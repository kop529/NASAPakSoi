"""Inspect the organizer Ground Station (PyInstaller, Python 3.13) without running it.

Run in WSL (python3 3.14 can marshal-load the 3.13 code objects; it cannot execute or `dis` them):
  1. node gs_unpack.js <GS .exe>          -> gs_script_main.pyc (main code object) + gs_pyz.bin
  2. python3 gs_inspect.py funcs <name>... -> consts / names / vars of every function whose qualname contains <name>
     python3 gs_inspect.py uses <word>...  -> functions whose constants contain <word> (e.g. SET_TARGET, MISSION_)
     python3 gs_inspect.py pyz [module]... -> list the PYZ archive, or extract modules to gs_pyz_<module>.bin
        (opcode, _opcode_metadata and dis of 3.13 are inside: the opcode table for a real disassembler)

6 Oct 2026 findings (GS v1.10.4): operation_prepare / _run_adcs_experiment send ADCS_TUNE (overwrites kp/kd/bias)
and SET_TARGET = first row of the target table before ADCS_MODE,AUTO; competition_prepare sends MISSION_NAME,
MISSION_TRANSFER, MISSION_TIME_LIMIT, MISSION_CLEAR_TARGETS, MISSION_TARGET, SET_TARGET, PREPARE; START = START_MISSION.
"""
import marshal
import struct
import sys
import types
import zlib

MAIN = 'gs_script_main.pyc'
PYZ = 'gs_pyz.bin'


def walk(c):
    yield c
    for k in c.co_consts:
        if isinstance(k, types.CodeType):
            yield from walk(k)


def show(c):
    print('=====', c.co_qualname, 'args', c.co_varnames[:c.co_argcount])
    print('  consts:', [k for k in c.co_consts if not isinstance(k, types.CodeType)])
    print('  names :', c.co_names)
    print('  vars  :', c.co_varnames)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    mode, words = sys.argv[1], sys.argv[2:]
    if mode == 'pyz':
        b = open(PYZ, 'rb').read()
        assert b[:4] == b'PYZ\0', 'not a PYZ archive'
        toc = marshal.loads(b[struct.unpack('!i', b[8:12])[0]:])
        d = dict(toc)
        if not words:
            print('\n'.join(sorted(d)))
            return
        for n in words:
            _, pos, ln = d[n]
            open('gs_pyz_' + n + '.bin', 'wb').write(zlib.decompress(b[pos:pos + ln]))
            print('wrote gs_pyz_' + n + '.bin')
        return
    co = marshal.loads(open(MAIN, 'rb').read())
    for c in walk(co):
        if mode == 'funcs' and any(w in c.co_qualname for w in words):
            show(c)
        elif mode == 'uses':
            cs = [k for k in c.co_consts if isinstance(k, str)]
            if any(any(w in k for k in cs) for w in words):
                show(c)


if __name__ == '__main__':
    main()
