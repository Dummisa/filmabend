"""
Filmabend – lokale Vorschau
===========================
Startet einen kleinen Webserver für den Ordner docs/ und öffnet die Seite
im Browser. Vorher wird kurz geprüft, ob die Schlüssel in docs/config.js
eingetragen sind.

In Positron:  Terminal öffnen (Menü Terminal → New Terminal) und eingeben:
                  python run.py
              Beenden mit Ctrl+C.

Optional anderer Port:   python run.py 8080
"""

import http.server
import os
import re
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(ROOT, 'docs')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


def read_config_value(text, name):
    """Liest einen String-Wert wie   name: 'wert'   aus config.js."""
    m = re.search(r'\b' + re.escape(name) + r'\s*:\s*[\'"]([^\'"]*)[\'"]', text)
    return m.group(1).strip() if m else ''


def check_config():
    path = os.path.join(DOCS, 'config.js')
    if not os.path.exists(path):
        print('!! docs/config.js fehlt.')
        return
    with open(path, encoding='utf-8') as f:
        text = f.read()

    tmdb = read_config_value(text, 'tmdbApiKey')
    fb_key = read_config_value(text, 'apiKey')
    fb_project = read_config_value(text, 'projectId')

    print('Konfiguration (docs/config.js):')
    print('  TMDB-Key ........... ' + ('OK' if tmdb else 'FEHLT  -> Filmsuche funktioniert nicht (README, Schritt 1)'))
    if fb_key and fb_project:
        print('  Firebase ........... OK (Projekt ' + fb_project + ')')
    else:
        print('  Firebase ........... FEHLT  -> apiKey und projectId eintragen (README, Schritt 2)')
    print()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DOCS, **kwargs)

    def end_headers(self):
        # Keine Caches, damit Änderungen sofort sichtbar sind
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Nur Fehler ausgeben, keine Zeile pro Request
        if args and str(args[1]).startswith(('4', '5')):
            super().log_message(fmt, *args)


def main():
    check_config()
    url = f'http://localhost:{PORT}/'
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError as e:
        print(f'Port {PORT} ist belegt ({e}). Anderen Port versuchen: python run.py 8080')
        sys.exit(1)

    print(f'Filmabend laeuft unter {url}   (Beenden mit Ctrl+C)')
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nBeendet.')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
