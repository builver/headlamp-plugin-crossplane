# ── Config ──────────────────────────────────────────────────────────
CLUSTER_NAME       ?= crossplane-dev
CROSSPLANE_VERSION ?= 2.3.1

# ── Dev ─────────────────────────────────────────────────────────────
.PHONY: build start lint lint-fix tsc test format package storybook

build:
	npm run build

start:
	npm run start

lint:
	npm run lint

lint-fix:
	npm run lint-fix

tsc:
	npm run tsc

test:
	npm run test

format:
	npm run format

package:
	npm run package

storybook:
	npm run storybook

# ── Cluster lifecycle ───────────────────────────────────────────────
.PHONY: cluster cluster-delete cluster-status

cluster: ## Create kind cluster and install Crossplane
	@command -v kind >/dev/null 2>&1 || { echo "kind not found — install from https://kind.sigs.k8s.io"; exit 1; }
	@command -v helm >/dev/null 2>&1 || { echo "helm not found — install from https://helm.sh"; exit 1; }
	@command -v kubectl >/dev/null 2>&1 || { echo "kubectl not found"; exit 1; }
	@if kind get clusters 2>/dev/null | grep -qx '$(CLUSTER_NAME)'; then \
		echo "Cluster '$(CLUSTER_NAME)' already exists"; \
	else \
		kind create cluster --name $(CLUSTER_NAME) --wait 60s; \
	fi
	@echo "--- Installing Crossplane $(CROSSPLANE_VERSION) ---"
	helm repo add crossplane-stable https://charts.crossplane.io/stable --force-update
	helm upgrade --install crossplane crossplane-stable/crossplane \
		--namespace crossplane-system --create-namespace \
		--version $(CROSSPLANE_VERSION) \
		--wait --timeout 120s
	@echo "--- Waiting for Crossplane pods ---"
	kubectl -n crossplane-system wait --for=condition=Ready pod --all --timeout=120s
	@echo ""
	@echo "Cluster ready. Context: kind-$(CLUSTER_NAME)"

cluster-delete: ## Delete the kind cluster
	kind delete cluster --name $(CLUSTER_NAME)

cluster-status: ## Show cluster and Crossplane status
	@kind get clusters 2>/dev/null | grep -qx '$(CLUSTER_NAME)' && echo "Cluster: running" || echo "Cluster: not found"
	@kubectl -n crossplane-system get pods 2>/dev/null || true

# ── Crossplane providers & functions ────────────────────────────────
.PHONY: providers

providers: ## Install common Crossplane providers and functions for testing
	@echo "--- Installing providers ---"
	kubectl apply -f hack/providers.yaml
	@echo "--- Waiting for providers to become healthy (up to 3m) ---"
	kubectl wait --for=condition=Healthy providers --all --timeout=180s 2>/dev/null || true
	kubectl wait --for=condition=Healthy functions --all --timeout=180s 2>/dev/null || true

# ── Example resources ───────────────────────────────────────────────
.PHONY: examples

examples: ## Deploy example XRDs, Compositions, and Claims
	@echo "--- Applying ProviderConfig for provider-kubernetes ---"
	kubectl apply -f hack/examples/provider-config-kubernetes.yaml
	@echo "--- Applying AppStack example (XRD + Composition + Claim) ---"
	kubectl apply -f hack/examples/app-stack/xrd.yaml
	kubectl apply -f hack/examples/app-stack/composition.yaml
	@sleep 2
	kubectl apply -f hack/examples/app-stack/claim.yaml
	@echo "Examples deployed. Check with: kubectl get appstacks -A"

# ── All-in-one ──────────────────────────────────────────────────────
.PHONY: up down

up: cluster providers examples ## Full setup: cluster + providers + examples
	@echo ""
	@echo "Ready. Start Headlamp desktop and connect to kind-$(CLUSTER_NAME)."

down: cluster-delete ## Tear everything down

# ── Help ────────────────────────────────────────────────────────────
.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
