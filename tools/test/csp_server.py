# Static server that mimics a locked-down artifact host: connect-src 'self' only.
import http.server, sys, functools
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; "
       "img-src 'self' blob: data:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; worker-src 'self' blob:")
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP); super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('', int(sys.argv[1])), functools.partial(H, directory=sys.argv[2])).serve_forever()
