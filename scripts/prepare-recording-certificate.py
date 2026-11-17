"""Generate a local recorder CA without changing certificate trust or proxy settings."""
import sys
from mitmproxy.certs import CertStore
CertStore.from_store(sys.argv[1], "mitmproxy", 2048)
