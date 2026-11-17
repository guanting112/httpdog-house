# =============================================================================
# httpdog house: develop, check and deploy (two Cloudflare Workers and one D1 database)
#
#   make            list every target
#   make setup      the whole first deployment to Cloudflare
#   make deploy     every deployment after that
#
#   UI Worker       the pages and their API, built by Nuxt         wrangler.jsonc
#   ingest Worker   receives httpdog's alerts and verifies them    ingest/wrangler.jsonc
#
# Those two files are committed and hold example values. What is yours (the database id, the
# receiver's address, your hostnames) is in deploy.local.env, which is not committed; the targets
# that reach Cloudflare put it into generated configs (scripts/deploy-config.ts).
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

# The database's binding in both wrangler.jsonc files. wrangler finds the database by it, so the
# commands below do not depend on what a deployment names its database
DB            := DB
UI_CONFIG     := wrangler.jsonc
INGEST_CONFIG := ingest/wrangler.jsonc
# Your values, and the two configs generated from them: the real names and the real database.
# Everything that reaches Cloudflare reads those, never the two files above.
# One file is one deployment. For another one in the same account:
#   make <target> DEPLOY_ENV=deploy.<suffix>.env      (see NAME_SUFFIX in deploy.local.env.example)
DEPLOY_ENV    ?= deploy.local.env
export DEPLOY_ENV
UI_DEPLOY     := wrangler.deploy.json
INGEST_DEPLOY := ingest/wrangler.deploy.json
DEPLOY_CONFIG := $(BUN) scripts/deploy-config.ts

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

##@ Deploy to Cloudflare

# setup is safe to run again: each step looks at what is there and does only what is missing
# (scripts/setup.ts). With DEPLOY_ENV=deploy.<suffix>.env it sets up another deployment
.PHONY: setup deploy
setup: install ## The first time: log in, create the database, upload both Workers, set their key, make an admin
	@$(BUN) scripts/setup.ts

deploy: check db-migrate deploy-ingest deploy-ui ## Every time after: check, update the tables, upload both Workers

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

FUZZ_RUNS ?= 20000

.PHONY: typecheck test check fuzz audit build dry-run
typecheck: ## Type-check the app, its API and the ingest Worker
	$(BUN) run typecheck

test: ## Unit tests: signatures, encryption, passwords, patterns, the ingest Worker against the real schema, setup
	$(BUN) test

check: typecheck test ## Everything above; run it before a deploy

# `make test` already runs test/fuzz.test.ts with 200 inputs per property. This looks much longer.
# A failure prints a seed: FUZZ_SEED=<seed> make fuzz runs exactly that again
fuzz: ## Fuzz for longer: FUZZ_RUNS inputs per property (default 20000)
	FUZZ_RUNS=$(FUZZ_RUNS) $(BUN) test test/fuzz.test.ts --timeout 3600000

audit: ## Look for known vulnerabilities in the packages (build tools included; they are not deployed)
	$(BUN) audit

build: ## Build the UI Worker into .output
	$(BUN) run build

dry-run: build ## Bundle both Workers and check both configs without uploading anything
	$(WRANGLER) deploy --dry-run -c $(INGEST_CONFIG)
	$(WRANGLER) deploy --dry-run

##@ Cloudflare, one step at a time (setup does these for you)

.PHONY: login whoami db-create check-config deploy-config db-migrate secrets admin
login: ## Log in to Cloudflare (opens the browser)
	$(WRANGLER) login

whoami: ## Show which Cloudflare account is logged in
	$(WRANGLER) whoami

# --update-config=false: wrangler would otherwise offer to write the id into wrangler.jsonc, which is committed
db-create: ## Create the D1 database; put the id it prints in deploy.local.env
	@[ -f $(DEPLOY_ENV) ] || { cp deploy.local.env.example $(DEPLOY_ENV); echo "wrote $(DEPLOY_ENV)"; }
	@name=$$($(DEPLOY_CONFIG) database-name) || exit 1; $(WRANGLER) d1 create "$$name" --update-config=false
	@echo
	@echo "  Put that database_id in $(DEPLOY_ENV) as DATABASE_ID. That file is not committed;"
	@echo "  leave the example id in $(UI_CONFIG) and $(INGEST_CONFIG) as it is."

check-config: ## Stop unless deploy.local.env is usable and the committed configs are still examples
	@$(DEPLOY_CONFIG) check

deploy-config: ## Write both Workers' real configs (wrangler.deploy.json) from deploy.local.env
	@$(DEPLOY_CONFIG) configs

db-migrate: deploy-config ## Create or update the tables in the real database (migrations/)
	$(WRANGLER) d1 migrations apply $(DB) --remote -c $(INGEST_DEPLOY)

# The key is generated here, handed to both Workers and kept nowhere else. Nobody needs to know it.
# Setting a new one makes the signing secrets already stored unreadable, hence the check.
secrets: deploy-config ## After the first deploy: give both Workers the same new SECRETS_KEY
	@if [ -z "$(FORCE)" ] && $(WRANGLER) secret list -c $(INGEST_DEPLOY) 2>/dev/null | grep -q SECRETS_KEY; then \
	  echo "SECRETS_KEY is already set. A new one makes every stored signing secret unreadable:"; \
	  echo "the keys would have to be created again. To do that anyway: make secrets FORCE=1"; exit 1; fi
	@KEY=$$(openssl rand -base64 32); \
	printf '%s' "$$KEY" | $(WRANGLER) secret put SECRETS_KEY -c $(INGEST_DEPLOY) && \
	printf '%s' "$$KEY" | $(WRANGLER) secret put SECRETS_KEY -c $(UI_DEPLOY)

admin: deploy-config ## Create or reset an admin in the real database: make admin NAME=you
	@[ -n "$(NAME)" ] || { echo "usage: make admin NAME=<username>"; exit 1; }
	$(BUN) scripts/create-admin.ts $(NAME) --remote

.PHONY: deploy-ingest deploy-ui tail-ingest tail-ui
deploy-ingest: deploy-config ## Upload only the receiver
	$(WRANGLER) deploy -c $(INGEST_DEPLOY)

# The build writes .output/server/wrangler.json from $(UI_CONFIG); your values go into that copy
deploy-ui: deploy-config build ## Build and upload only the UI
	@$(DEPLOY_CONFIG) ui
	$(WRANGLER) deploy

tail-ingest: deploy-config ## Follow the receiver's live log
	$(WRANGLER) tail -c $(INGEST_DEPLOY)

tail-ui: deploy-config ## Follow the UI Worker's live log (the audit lines are here)
	$(WRANGLER) tail -c $(UI_DEPLOY)

##@ Clean up

.PHONY: clean reset-local-db
clean: ## Delete build output and caches (node_modules and the local database stay)
	rm -rf .output .nuxt .data dist node_modules/.cache/nuxt .wrangler/deploy .wrangler/tmp ingest/.wrangler $(UI_DEPLOY) $(INGEST_DEPLOY)

reset-local-db: ## Delete the local database and everything in it, then create it again empty
	rm -rf $(STATE)
	$(WRANGLER) d1 migrations apply $(DB) --local -c $(UI_CONFIG)
