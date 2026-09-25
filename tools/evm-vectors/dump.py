import json
v=json.load(open('vectors.json'))
raw=bytes.fromhex(v['txs'][2]['raw'][2:])

def dec(b):
    p = b[0]
    if p <= 0x7f:
        return b[0:1], b[1:]
    if p <= 0xb7:
        n = p - 0x80
        return b[0:1+n], b[1+n:]
    if p <= 0xbf:
        k = p - 0xb7
        n = int.from_bytes(b[1:1+k], 'big')
        s = 1 + k
        return b[0:s+n], b[s+n:]
    if p <= 0xf7:
        n = p - 0xc0
        s = 1
    else:
        k = p - 0xf7
        n = int.from_bytes(b[1:1+k], 'big')
        s = 1 + k
    inner = b[s:s+n]
    out = []
    while inner:
        it, inner = dec(inner)
        out.append(it)
    return b[0:s+n], b[s+n:]

items = []
rest = raw[1:]
while rest:
    it, rest = dec(rest)
    items.append(it)

names = ['chainId','nonce','maxPrio','maxFee','gas','to','value','data','accessList','yParity','r','s']
for n, it in zip(names, items):
    print("%-11s len=%3d hex=%s" % (n, len(it), it.hex()))
