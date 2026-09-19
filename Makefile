# LiraShield — build & deploy helpers.
# Usage: make <target>   (see `make help`)

CONTRACT_DIR := contracts/vault
WASM := target/wasm32v1-none/release/lirashield_vault.wasm
NETWORK := testnet
SOURCE := lirashield-admin

.PHONY: help
help:
	@echo "make contract-test     Run the Soroban contract's unit tests"
	@echo "make contract-build    Build the contract to WASM"
	@echo "make contract-deploy   Deploy the built WASM to Stellar Testnet (needs identity: $(SOURCE))"
	@echo "make frontend-install  Install frontend dependencies"
	@echo "make frontend-dev      Run the Next.js dev server"
	@echo "make frontend-build    Production-build the frontend"

.PHONY: contract-test
contract-test:
	cargo test -p lirashield-vault

.PHONY: contract-build
contract-build:
	stellar contract build

.PHONY: contract-deploy
contract-deploy: contract-build
	stellar contract deploy \
		--wasm $(WASM) \
		--source $(SOURCE) \
		--network $(NETWORK)

.PHONY: frontend-install
frontend-install:
	cd frontend && npm install

.PHONY: frontend-dev
frontend-dev:
	cd frontend && npm run dev

.PHONY: frontend-build
frontend-build:
	cd frontend && npm run build
