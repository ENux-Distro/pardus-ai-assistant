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

# The OpenCode engine is cloned + compiled from our fork by `make engine`; it is
# NOT committed to this repo (so it stays patchable and up to date). It lives in
# ./opencode inside the app dir.
ENGINE_REMOTE ?= https://github.com/ENux-Distro/opencode.git
ENGINE_BRANCH ?= dev
OPENCODE_DIR  := $(APP_DIR)/opencode

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Pardus Assistant"
	@echo "  make install     clone+compile the engine, install the command and menu entry"
	@echo "  make engine      clone/update the OpenCode fork and compile it"
	@echo "  make run         run the backend in the foreground (http://127.0.0.1:5174)"
	@echo "  make app         start the server (if needed) and open the app window"
	@echo "  make stop        stop the background server"
	@echo "  make logs        follow the server log"
	@echo "  make uninstall   remove the command and menu entry"

# Install bun to ~/.bun if not already on PATH.
.PHONY: install-bun
install-bun: no-sudo
	@if command -v bun >/dev/null 2>&1; then \
		:; \
	elif [ -x "$(HOME)/.bun/bin/bun" ]; then \
		export PATH="$(HOME)/.bun/bin:$$PATH"; \
	else \
		echo "Installing bun…"; \
		curl -fsSL https://bun.sh/install | bash; \
		if [ ! -x "$(HOME)/.bun/bin/bun" ]; then \
			echo "Error: bun installation failed."; \
			exit 1; \
		fi; \
		export PATH="$(HOME)/.bun/bin:$$PATH"; \
	fi

.PHONY: no-sudo
no-sudo:
	@if [ "$$(id -u)" = "0" ]; then \
		echo "Don't run this with sudo — it installs into your home directory."; \
		echo "Run it as your normal user:  make install"; \
		exit 1; \
	fi

# Clone (or update) the OpenCode fork and compile it into a single native binary.
# This is the heavy step: it fetches the engine source, installs its deps, and
# runs the standalone build. Output: $(OPENCODE_DIR)/packages/opencode/dist/...
.PHONY: engine
engine: no-sudo install-bun
	@BUN="$$(command -v bun 2>/dev/null || echo "$(HOME)/.bun/bin/bun")"; \
	if [ -z "$$BUN" ] || [ ! -x "$$BUN" ]; then echo "Error: bun not found after install."; exit 1; fi; \
	if [ -z "$$(command -v git)" ]; then echo "Error: git is required."; exit 1; fi; \
	if [ -d "$(OPENCODE_DIR)/.git" ]; then \
		echo "Updating the OpenCode engine fork…"; \
		git -C "$(OPENCODE_DIR)" fetch --depth 1 origin "$(ENGINE_BRANCH)"; \
		git -C "$(OPENCODE_DIR)" reset --hard "origin/$(ENGINE_BRANCH)"; \
	else \
		echo "Cloning the OpenCode engine fork ($(ENGINE_REMOTE))…"; \
		rm -rf "$(OPENCODE_DIR)"; \
		git clone --depth 1 --branch "$(ENGINE_BRANCH)" "$(ENGINE_REMOTE)" "$(OPENCODE_DIR)"; \
	fi; \
	echo "Installing engine dependencies…"; \
	cd "$(OPENCODE_DIR)" && "$$BUN" install; \
	echo "Compiling the engine — this can take a few minutes…"; \
	cd "$(OPENCODE_DIR)" && "$$BUN" run ./packages/opencode/script/build.ts --single; \
	echo "Engine compiled."

.PHONY: install
install: engine
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
run: no-sudo install-bun
	@BUN="$$(command -v bun 2>/dev/null || echo "$(HOME)/.bun/bin/bun")"; \
	if [ -z "$$BUN" ] || [ ! -x "$$BUN" ]; then echo "Error: bun not found after install."; exit 1; fi; \
	cd "$(APP_DIR)" && "$$BUN" run backend/src/server.ts

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

# Also remove the engine's deps and compiled output (run `make engine` after).
.PHONY: distclean
distclean: clean
	@rm -rf "$(OPENCODE_DIR)/node_modules" "$(OPENCODE_DIR)/packages/opencode/dist"
	@echo "Removed engine dependencies and compiled binary."
