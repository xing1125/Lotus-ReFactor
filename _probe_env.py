import ctypes, ctypes.wintypes as wt, sys

pid = int(sys.argv[1])
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
ntdll = ctypes.WinDLL("ntdll")

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010

h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
if not h:
    print("OpenProcess failed", ctypes.get_last_error())
    sys.exit(1)

# PROCESS_BASIC_INFORMATION
class PBI(ctypes.Structure):
    _fields_ = [
        ("Reserved1", ctypes.c_void_p),
        ("PebBaseAddress", ctypes.c_void_p),
        ("Reserved2_0", ctypes.c_void_p),
        ("Reserved2_1", ctypes.c_void_p),
        ("UniqueProcessId", ctypes.c_void_p),
        ("Reserved3", ctypes.c_void_p),
    ]

pbi = PBI()
ret = ntdll.NtQueryInformationProcess(h, 0, ctypes.byref(pbi), ctypes.sizeof(pbi), None)
if ret != 0:
    print("NtQueryInformationProcess failed", ret)
    sys.exit(1)

def read(addr, size):
    buf = ctypes.create_string_buffer(size)
    n = ctypes.c_size_t(0)
    ok = k32.ReadProcessMemory(h, ctypes.c_void_p(addr), buf, size, ctypes.byref(n))
    if not ok:
        return None
    return buf.raw[: n.value]

peb = pbi.PebBaseAddress
raw = read(peb + 0x20, 8)
if not raw:
    print("read PEB.ProcessParameters failed")
    sys.exit(1)
params = int.from_bytes(raw, "little")

raw = read(params + 0x80, 8)
env_ptr = int.from_bytes(raw, "little")
raw = read(params + 0x3F0, 8)
env_size = int.from_bytes(raw, "little")

if not (0 < env_size < 1 << 20):
    env_size = 32768

KEYS = {
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy", "TZ", "NODE_OPTIONS",
}

data = read(env_ptr, env_size) or b""
text = data.decode("utf-16-le", errors="ignore")
for line in text.split("\x00"):
    if not line:
        continue
    if line.split("=", 1)[0].strip().upper() in KEYS:
        print(line)
