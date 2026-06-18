# Pardus Assistant — install, run and packaging helpers.
#
# Common targets:
#   make install     install engine deps + a `pardus-assistant` command + menu entry
#   make run         start the backend in the foreground (dev)
#   make app         start (if needed) and open the app window
#   make stop        stop the background server
#   make uninstall   remove the command and menu entry

SHELL := /bin/bash

BINDIR  ?= $(HOME)/.local/bin
APPSDIR ?= $(HOME)/.local/share/applications
APP_DIR := $(abspath .)
LAUNCHER := $(APP_DIR)/bin/pardus-assistant
DESKTOP  := $(APPSDIR)/pardus-assistant.desktop

# Find bun on PATH, falling back to the usual per-user install location.
BUN := $(shell command -v bun 2>/dev/null || ([ -x "$(HOME)/.bun/bin/bun" ] && echo "$(HOME)/.bun/bin/bun"))

# The OpenCode engine source — nested (./opencode) or a sibling (../opencode).
OPENCODE_DIR := $(abspath $(if $(wildcard opencode),opencode,../opencode))

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Pardus Assistant"
	@echo "  make install     install engine deps, the 'pardus-assistant' command and menu entry"
	@echo "  make run         run the backend in the foreground (http://127.0.0.1:5174)"
	@echo "  make app         start the server (if needed) and open the app window"
	@echo "  make stop        stop the background server"
	@echo "  make logs        follow the server log"
	@echo "  make uninstall   remove the command and menu entry"

.PHONY: no-sudo
no-sudo:
	@if [ "$$(id -u)" = "0" ]; then \
		echo "Don't run this with sudo — it installs into your home directory."; \
		echo "Run it as your normal user:  make install"; \
		exit 1; \
	fi

.PHONY: deps
deps: no-sudo
	@if [ -z "$(BUN)" ]; then echo "Error: bun is required. Install from https://bun.sh"; exit 1; fi
	@if [ ! -d "$(OPENCODE_DIR)" ]; then echo "Error: OpenCode engine not found at $(OPENCODE_DIR)"; exit 1; fi
	@echo "Installing OpenCode engine dependencies (one-time)…"
	@cd "$(OPENCODE_DIR)" && "$(BUN)" install

.PHONY: install
install: deps
	@chmod +x "$(LAUNCHER)"
	@mkdir -p "$(BINDIR)" "$(APPSDIR)"
	@ln -sf "$(LAUNCHER)" "$(BINDIR)/pardus-assistant"
	@printf '%s\n' \
		'[Desktop Entry]' \
		'Type=Application' \
		'Name=Pardus Assistant' \
		'Comment=A friendly AI helper for your computer' \
		'Exec=$(BINDIR)/pardus-assistant' \
		'Icon=system-help' \
		'Terminal=false' \
		'Categories=Utility;System;' \
		'StartupWMClass=PardusAssistant' \
		> "$(DESKTOP)"
	@echo ""
	@echo "Installed. Launch it from your application menu, or run: pardus-assistant"
	@echo "(If 'pardus-assistant' isn't found, add $(BINDIR) to your PATH.)"

.PHONY: run
run: no-sudo
	@if [ -z "$(BUN)" ]; then echo "Error: bun is required. Install from https://bun.sh"; exit 1; fi
	@cd "$(APP_DIR)" && "$(BUN)" run backend/src/server.ts

.PHONY: app
app:
	@"$(LAUNCHER)"

.PHONY: stop
stop:
	@"$(LAUNCHER)" --stop

.PHONY: logs
logs:
	@tail -f "$${XDG_STATE_HOME:-$$HOME/.local/state}/pardus-assistant/server.log"

.PHONY: uninstall
uninstall:
	@rm -f "$(BINDIR)/pardus-assistant" "$(DESKTOP)"
	@echo "Removed command and menu entry. Saved conversations were left untouched."

STATE_DIR := $${XDG_STATE_HOME:-$$HOME/.local/state}/pardus-assistant

# Remove local logs and runtime files (safe to run anytime). Keeps your chats.
.PHONY: clean
clean:
	@rm -f "$(APP_DIR)/backend/actions.log"
	@rm -f "$(STATE_DIR)/server.log" "$(STATE_DIR)/server.pid"
	@echo "Cleaned logs and runtime files. Saved conversations were left untouched."

# Also remove the installed engine dependencies (run `make install` again after).
.PHONY: distclean
distclean: clean
	@rm -rf "$(OPENCODE_DIR)/node_modules"
	@echo "Removed engine dependencies."
