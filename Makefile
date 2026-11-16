# =============================================================================
# httpdog house: develop, check and deploy (two Cloudflare Workers and one D1 database)
#
#   make            list every target
#
#   UI Worker       the pages and their API, built by Nuxt         wrangler.jsonc
#   ingest Worker   receives httpdog's alerts and verifies them    ingest/wrangler.jsonc
#
# These are shortcuts for bun and wrangler commands. Everything is built on this machine and
# uploaded with wrangler; Cloudflare builds nothing and does not read the Git repository.
#
# wrangler commands here always name their config file (-c). After a build, wrangler run without
# one follows .wrangler/deploy/config.json to the config Nitro generated; that is what the UI's
# deploy wants and nothing else does.
# =============================================================================

SHELL    := /bin/bash
BUN      := bun
WRANGLER := bunx wrangler

# `database_name` in both wrangler.jsonc files
DB            := httpdog-house
UI_CONFIG     := wrangler.jsonc
INGEST_CONFIG := ingest/wrangler.jsonc
# The database_id both files ship with; deploying refuses to go on while it is still there
PLACEHOLDER   := 00000000-0000-0000-0000-000000000000

# Ports: nuxt dev, the ingest Worker, and the built UI under wrangler (make preview)
PORT         ?= 3000
INGEST_PORT  ?= 8788
PREVIEW_PORT ?= 8787

# Both Workers keep their local state (the local D1 database) in one place, so they share it
STATE := .wrangler/state

.DEFAULT_GOAL := help

.PHONY: help
help: ## List every target
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)}' $(MAKEFILE_LIST)

##@ Local development

.PHONY: install dev-init dev dev-ui dev-ingest admin-local test-alert preview
install: ## Install packages exactly as bun.lock lists them
	$(BUN) install --frozen-lockfile

dev-init: ## Once per checkout: local secrets (.dev.vars) and the local database
	@if [ -f .dev.vars ]; then echo ".dev.vars exists, keeping it"; else \
	  printf 'SECRETS_KEY=%s\nINGEST_URL=http://localhost:$(INGEST_PORT)/alerts\n' "$$(openssl rand -base64 32)" > .dev.vars; \
	  echo "wrote .dev.vars"; fi
	@# the ingest Worker must decrypt what the UI encrypted: the same key, always
	@grep '^SECRETS_KEY=' .dev.vars > ingest/.dev.vars
	$(WRANGLER) d1 migrations apply $(DB) --local -c $(UI_CONFIG)
	@echo
	@echo "  next: make admin-local NAME=<you>, then make dev"

dev: ## Both Workers: the UI on http://localhost:3000, the receiver on http://localhost:8788
	@trap 'kill 0' INT TERM EXIT; \
	$(BUN) run dev --port $(PORT) & \
	$(WRANGLER) dev -c $(INGEST_CONFIG) --port $(INGEST_PORT) --persist-to $(STATE) & \
	wait

dev-ui: ## Only the UI (change the port with PORT=)
	$(BUN) run dev --port $(PORT)

dev-ingest: ## Only the receiver (change the port with INGEST_PORT=)
	$(WRANGLER) dev -c $(INGEST_CONFIG) --port $(INGEST_PORT) --persist-to $(STATE)

admin-local: ## Create or reset an admin in the local database: make admin-local NAME=you
	@[ -n "$(NAME)" ] || { echo "usage: make admin-local NAME=<username>"; exit 1; }
	$(BUN) scripts/create-admin.ts $(NAME) --local

test-alert: ## Send one signed test alert to the local receiver: make test-alert SECRET=... INSTANCE=web-01
	@[ -n "$(SECRET)" ] && [ -n "$(INSTANCE)" ] || { echo "usage: make test-alert SECRET=<a key's secret> INSTANCE=<name>"; exit 1; }
	@HTTPDOG_WEBHOOK_SECRET='$(SECRET)' $(BUN) scripts/send-test-alert.ts http://localhost:$(INGEST_PORT)/alerts $(INSTANCE)

preview: build ## Build the UI, then run it the way Cloudflare will (http://localhost:8787)
	$(WRANGLER) dev --port $(PREVIEW_PORT) --persist-to $(STATE)

##@ Checks

.PHONY: typecheck test check audit build dry-run
typecheck: ## Type-check the app, its API and the ingest Worker
	$(BUN) run typecheck

test: ## Unit tests: signatures, encryption, passwords, patterns, and the ingest Worker against the real schema
	$(BUN) test

check: typecheck test ## Everything above; run it before a deploy

audit: ## Look for known vulnerabilities in the packages (build tools included; they are not deployed)
	$(BUN) audit

build: ## Build the UI Worker into .output
	$(BUN) run build

dry-run: build ## Bundle both Workers and check both configs without uploading anything
	$(WRANGLER) deploy --dry-run -c $(INGEST_CONFIG)
	$(WRANGLER) deploy --dry-run

##@ Cloudflare, the first time (in this order)

.PHONY: login whoami db-create check-config db-migrate secrets admin
login: ## Log in to Cloudflare (opens the browser)
	$(WRANGLER) login

whoami: ## Show which Cloudflare account is logged in
	$(WRANGLER) whoami

db-create: ## 1. Create the D1 database; put the id it prints in both wrangler.jsonc files
	$(WRANGLER) d1 create $(DB)
	@echo
	@echo "  Put that database_id in $(UI_CONFIG) and in $(INGEST_CONFIG), replacing $(PLACEHOLDER)."

check-config: ## Stop if the two Workers do not name the same, real database
	@ui=$$(grep -o '"database_id": *"[^"]*"' $(UI_CONFIG) | cut -d'"' -f4); \
	ingest=$$(grep -o '"database_id": *"[^"]*"' $(INGEST_CONFIG) | cut -d'"' -f4); \
	if [ -z "$$ui" ] || [ "$$ui" = "$(PLACEHOLDER)" ]; then echo "error: $(UI_CONFIG) still has the example database_id; run make db-create first"; exit 1; fi; \
	if [ "$$ui" != "$$ingest" ]; then echo "error: database_id differs between $(UI_CONFIG) and $(INGEST_CONFIG); both Workers must use one database"; exit 1; fi
	@if grep -q 'INGEST_URL.*\.example\.' $(UI_CONFIG); then echo "note: INGEST_URL in $(UI_CONFIG) is still the example; the keys page will show the wrong address until it is set"; fi

db-migrate: check-config ## 2. Create or update the tables in the real database (migrations/)
	$(WRANGLER) d1 migrations apply $(DB) --remote -c $(UI_CONFIG)

# The key is generated here, handed to both Workers and kept nowhere else. Nobody needs to know it.
# Setting a new one makes the signing secrets already stored unreadable, hence the check.
secrets: ## 4. After the first deploy: give both Workers the same new SECRETS_KEY
	@if [ -z "$(FORCE)" ] && $(WRANGLER) secret list -c $(INGEST_CONFIG) 2>/dev/null | grep -q SECRETS_KEY; then \
	  echo "SECRETS_KEY is already set. A new one makes every stored signing secret unreadable:"; \
	  echo "the keys would have to be created again. To do that anyway: make secrets FORCE=1"; exit 1; fi
	@KEY=$$(openssl rand -base64 32); \
	printf '%s' "$$KEY" | $(WRANGLER) secret put SECRETS_KEY -c $(INGEST_CONFIG) && \
	printf '%s' "$$KEY" | $(WRANGLER) secret put SECRETS_KEY -c $(UI_CONFIG)

admin: ## 5. Create or reset an admin in the real database: make admin NAME=you
	@[ -n "$(NAME)" ] || { echo "usage: make admin NAME=<username>"; exit 1; }
	$(BUN) scripts/create-admin.ts $(NAME) --remote

##@ Deploy

.PHONY: deploy deploy-ingest deploy-ui tail-ingest tail-ui
deploy: check db-migrate deploy-ingest deploy-ui ## 3. Check, migrate, then upload both Workers

deploy-ingest: check-config ## Upload only the receiver
	$(WRANGLER) deploy -c $(INGEST_CONFIG)

deploy-ui: check-config build ## Build and upload only the UI
	$(WRANGLER) deploy

tail-ingest: ## Follow the receiver's live log
	$(WRANGLER) tail -c $(INGEST_CONFIG)

tail-ui: ## Follow the UI Worker's live log (the audit lines are here)
	$(WRANGLER) tail -c $(UI_CONFIG)

##@ Clean up

.PHONY: clean reset-local-db
clean: ## Delete build output and caches (node_modules and the local database stay)
	rm -rf .output .nuxt .data dist node_modules/.cache/nuxt .wrangler/deploy .wrangler/tmp ingest/.wrangler

reset-local-db: ## Delete the local database and everything in it, then create it again empty
	rm -rf $(STATE)
	$(WRANGLER) d1 migrations apply $(DB) --local -c $(UI_CONFIG)
