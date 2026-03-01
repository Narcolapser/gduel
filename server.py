from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import sys, os

directory = sys.argv[1] if len(sys.argv) > 1 else "."
os.chdir(directory)
server = ThreadingHTTPServer(("0.0.0.0", 8000), SimpleHTTPRequestHandler)
print(f"Serving {directory} at http://localhost:8000")
server.serve_forever()
