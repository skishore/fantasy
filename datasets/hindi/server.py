import mimetypes
import SimpleHTTPServer
import SocketServer

class Handler(SimpleHTTPServer.SimpleHTTPRequestHandler):
    def guess_type(self, url, strict=True):
        (type, encoding) = mimetypes.guess_type(url, strict)
        if (url.endswith('grammar_files/load.php') or
            url.endswith('grammar_files/load(2).php') or
            url.endswith('grammar_files/load(3).php')):
            return 'text/css'
        return type or 'text/html'

class ReusableTCPServer(SocketServer.TCPServer):
    allow_reuse_address = True

ReusableTCPServer(('', 8000), Handler).serve_forever()
