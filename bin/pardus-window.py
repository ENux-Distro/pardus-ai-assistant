#!/usr/bin/env python3
# A minimal native window that renders the Pardus Assistant UI — just a window
# wrapping the local page, with no browser tabs, address bar or menus.
import sys
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib, GdkPixbuf

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5174"

# Bail out cleanly (no traceback) if there's no usable display — the launcher
# then falls back to a browser.
if not Gtk.init_check()[0]:
    print("No graphical display available.", file=sys.stderr)
    sys.exit(1)

# Helps the window manager group/label the app correctly (taskbar, alt-tab).
GLib.set_prgname("PardusAssistant")
GLib.set_application_name("Pardus Assistant")

win = Gtk.Window()
win.set_title("Pardus Assistant")
win.set_default_size(1180, 800)
# Show no application logo, just the title: use a 1x1 fully transparent icon.
try:
    blank = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, True, 8, 1, 1)
    blank.fill(0x00000000)
    win.set_icon(blank)
except Exception:
    pass

view = WebKit2.WebView()
view.load_uri(URL)
win.add(view)

win.connect("destroy", Gtk.main_quit)
win.show_all()
Gtk.main()
