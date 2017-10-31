import mimetypes
import SimpleHTTPServer
import SocketServer

class Handler(SimpleHTTPServer.SimpleHTTPRequestHandler):
    def guess_type(self, url, strict=True):
        (type, encoding) = mimetypes.guess_type(url, strict)
        return (type or 'text/html', encoding)

class ReusableTCPServer(SocketServer.TCPServer):
    allow_reuse_address = True

ReusableTCPServer(('', 8000), Handler).serve_forever()
