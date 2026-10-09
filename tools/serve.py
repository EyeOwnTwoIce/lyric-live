#!/usr/bin/env python3
"""Servidor local para desarrollo.

Por que no `python3 -m http.server` a secas: ese servidor es mono-hilo y los
navegadores abren muchas conexiones en paralelo para los modulos ES, lo que
provoca ERR_CONNECTION_RESET aleatorios. Aqui usamos ThreadingHTTPServer.

Ademas:
  - Anade el tipo MIME correcto para .webmanifest y .js como text/javascript.
  - Envia cabeceras no-cache, para que al editar no haya que recargar a mano.

Uso:  python3 tools/serve.py [puerto]
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    # HTTP/1.1 habilita keep-alive. Con el HTTP/1.0 por defecto el servidor
    # cierra la conexion despues de cada respuesta; el navegador intenta
    # reutilizarla, recibe un reset y carga los modulos ES a medias, lo que
    # produce errores fantasma del tipo "Unexpected token '}'".
    protocol_version = 'HTTP/1.1'

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".webmanifest": "application/manifest+json",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".css": "text/css",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = partial(Handler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Letra en vivo -> http://localhost:{port}")
        print("Microfono disponible en localhost. Ctrl+C para parar.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nParando…")


if __name__ == "__main__":
    main()
