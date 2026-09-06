# Model identity disambiguation across AI gateways and chat UIs

**Date:** 2026-08-17\
**Scope:** How products form a unique model key, what users see in pickers, whether display aliases exist, and how duplicate upstream model IDs across providers/connections are handled.\
**Method:** Primary sources only (official docs, GitHub source, config schemas, public Models API). Speculation is marked.

**No new project domain boundaries** — research note only; no `CONTEXT.md` / ADR updates.

---

## Summary table

| Product | Unique key (API / internal) | What users see | User display aliases? | Same model ID on multiple endpoints |
| --- | --- | --- | --- | --- |
| OpenRouter | `author/slug` (+ optional `:variant`) | Human `name`; API uses `id` | Platform-defined `name`; aliases resolve to canonical | Multiple *providers* for one model ID via routing (not separate picker rows) |
| LiteLLM Proxy | Client-facing `model_name`; backend `provider/…` | Client sends `model_name` | Yes — `model_name` is the alias; `model_group_alias` | Same `model_name` → load-balanced deployments |
| Open WebUI | Model `id` (optionally `prefix_id.upstream_id`) + connection `urlIdx` | Model name/id in selector; Workspace Models have Name + ID | Yes — Workspace Model Name/ID; connection `prefix_id` / tags | Intended: set per-connection `prefix_id` so IDs don’t collide |
| Continue.dev | Config entry; display via `name` | `name` in UI | Yes — required unique `name`; separate `model` id | Two entries with same `model` but different `name` / `provider` / `apiBase` |
| LibreChat | Endpoint `name` + model string; optional Model Spec `name` | Endpoint title + model; Spec `label` | Yes — Spec `label` / `modelLabel`; endpoint `modelDisplayLabel` | Separate custom endpoints (unique `name`); Specs bind endpoint+model |
| SillyTavern | Active API connection + model ID | Connection type + model dropdown/field | Limited — connection presets; model ID as entered | Docs describe one Chat Completion connection flow; no documented ID-prefix scheme |
| AnythingLLM | System/workspace LLM provider + model/deployment pref | Provider settings + model preference | Provider-level model pref | Provider is singular setting; Azure deployment name is the “model” |
| Azure OpenAI | **Deployment name** (not foundation model name) | Portal deployment name | Deployment name is user-chosen | Multiple deployments can wrap the same underlying model under different names |

---

## 1. OpenRouter

### Sources
- Models API / schema: https://openrouter.ai/docs/guides/overview/models\
- Provider routing: https://openrouter.ai/docs/guides/routing/provider-selection\
- Live Models API sample (2026-08-17): https://openrouter.ai/api/v1/models\

### Unique key
- Request/list identifier: **`id`**, documented as e.g. `"google/gemini-2.5-pro-preview"` — author/org slug + model slug.
- Lookup path: `GET /api/v1/model/{author}/{slug}`; aliases resolve to a canonical model; variant suffixes such as `:free`, `:thinking` are supported on the slug.
- Separate fields: **`canonical_slug`** (permanent slug that never changes) and human-readable **`name`**.

Observed live `id` / `name` / `canonical_slug` examples:

| id | name | canonical_slug |
| --- | --- | --- |
| `qwen/qwen3.8-27b` | Qwen: Qwen3.8 27B | `qwen/qwen3.8-27b-20260814` |
| `google/gemini-3.7-flash` | Google: Gemini 3.7 Flash | `google/gemini-3.7-flash-20260813` |
| `dots-studio/dots-3-note-preview:free` | … (free) | `dots-studio/dots-3-note-preview-20260813` |

### Picker / display
- UI/catalog uses human **`name`**; clients call with **`id`**.

### Display aliases
- Platform defines `name` and resolves **aliases** to the canonical model on single-model lookup.
- Users do not define custom display names in the Models API schema (operator product, not self-hosted UI config).

### Multi-endpoint / same model ID
- One OpenRouter **model `id`** can be served by many upstream providers. Routing is controlled via the request `provider` object (`order`, `only`, `ignore`, sort by price/throughput/latency, etc.), not by minting separate model IDs per backend.
- **Pattern:** namespaced model ID + provider routing preferences, not connection-scoped IDs.

---

## 2. LiteLLM

### Sources
- Proxy config: https://docs.litellm.ai/docs/proxy/configs\
- OpenAI-compatible provider prefix: https://docs.litellm.ai/docs/providers/openai_compatible\
- Azure provider: https://docs.litellm.ai/docs/providers/azure\
- Router / load balancing: https://docs.litellm.ai/docs/routing\

### Unique key
Two layers:

1. **Client-facing:** `model_list[].model_name` — “the name to pass TO litellm from the external client.”
2. **Backend:** `litellm_params.model` — string passed to `litellm.completion()`, typically **`provider/…`** (examples: `azure/gpt-4o-eu`, `openai/facebook/opt-125m`, `bedrock/anthropic.claude-instant-v1`).

Azure docs: `model=azure/<your deployment name>`.

Optional: `router_settings.model_group_alias` (e.g. `{"gpt-4": "gpt-4o"}`) remaps requested names to a model group.

### Picker / display
- Gateway clients see whatever `model_name` values are configured (and routing groups named in config). Group names appear in `/v1/models` for discovery-oriented clients.

### Display aliases
- **Yes.** `model_name` is explicitly the user-facing alias; multiple YAML entries can share one `model_name`.

### Multi-endpoint / same model ID
- **Same `model_name`, different `litellm_params` (api_base / region / key):** treated as **one model group** and **load-balanced** (strategies: `simple-shuffle`, `least-busy`, usage/latency-based, etc.).
- Docs example: `model=gpt-4o` balances between `azure/gpt-4o-eu` and `azure/gpt-4o-ca`.
- To expose the *same* upstream model ID as **distinct selectable models**, operators give them **different `model_name`s** (e.g. `gpt-4-team1` vs `gpt-4-team2`).
- **Pattern:** alias layer (`model_name`) vs provider-qualified backend string; duplicate aliases mean pool, not collision.

---

## 3. Open WebUI

### Sources
- Workspace Models docs: https://docs.openwebui.com/features/workspace/models/\
- Connections UI pointer: https://docs.openwebui.com/getting-started/quick-start/ (Admin Settings → Connections)\
- Primary implementation:\
  - https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/openai.py\
  - https://github.com/open-webui/open-webui/blob/main/backend/open_webui/utils/model_ids.py\

### Unique key
From OpenAI connection aggregation (`get_all_models` path in `openai.py`):

- Each upstream model is associated with connection index **`urlIdx`**.
- Optional per-connection **`prefix_id`**: if set,\
  `model['id'] = f'{prefix_id}.{model.get("id", model.get("name", ""))}'`.
- On request, `strip_provider_model_prefix` strips `{prefix_id}.` before calling the upstream API.
- Connections may also set `tags`, `connection_type`, `provider`, and explicit `model_ids`.

Workspace “Models” (presets/agents) document **Name and ID** as “Display name and unique identifier”, plus **Base Model** pointing at the connected model.

### Picker / display
- Connected models appear in the model selector (id/name from upstream, possibly prefixed).
- Workspace Models show **Name**, **Description**, **Tags**, visibility.

### Display aliases
- **Yes** for Workspace Models (Name vs ID vs Base Model).
- Connection-level **`prefix_id`** and **`tags`** disambiguate/label connection-sourced models (not a free-form “display name” field in the snippet reviewed; prefix mutates the id itself).

### Multi-endpoint / same model ID
- Without `prefix_id`, two OpenAI-compatible connections that both return `gpt-4o` would produce **identical `id` strings** in the aggregated list.\
  **Speculation (implementation-dependent):** last-write / map-by-id behavior may hide or overwrite; the code’s designed mitigation is **`prefix_id`** so IDs become e.g. `openai-prod.gpt-4o` vs `azure-west.gpt-4o`, while `urlIdx` still selects the connection.
- **Pattern:** optional connection namespace prefix + index binding; separate persona layer (Workspace Models) on top of base model ids.

---

## 4. Continue.dev

### Sources
- `config.yaml` reference: https://docs.continue.dev/reference\
- Model providers overview: https://docs.continue.dev/customize/model-providers/overview\

### Unique key
Each models[] entry has:

| Field | Role |
| --- | --- |
| `name` | **Required.** “A unique name to identify the model within your configuration.” |
| `provider` | Required backend selector (`openai`, `anthropic`, `ollama`, …) |
| `model` | Required provider model id (`gpt-4o`, `claude-sonnet-4-20250514`, …) |
| `apiBase` | Optional endpoint override |

Identity for selection is the config **`name`**, not the provider `model` string alone.

### Picker / display
- Users pick by **`name`** (examples: `GPT-4o`, `Codestral`, `My Model - OpenAI-Compatible`).

### Display aliases
- **Yes** — `name` is the display/unique handle; `model` stays the wire id.

### Multi-endpoint / same model ID
- Configure multiple entries with the same `model` value but different `name`, `provider`, and/or `apiBase`. Continue does not require globally unique `model` strings.
- **Pattern:** explicit title vs wire id (classic UI alias).

---

## 5. LibreChat

### Sources
- Custom endpoints quick start: https://www.librechat.ai/docs/quick_start/custom_endpoints\
- Custom endpoint object: https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint\
- Model Specs: https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/model_specs\
- Azure OpenAI object: https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/azure_openai\

### Unique key
1. **Endpoints:** custom endpoint **`name`** must be unique; used as the title in the Endpoints selector. Must not collide with built-in keys (`openAI`, `azureOpenAI`, …).
2. **Models within an endpoint:** strings in `models.default` and/or fetched from the provider (`models.fetch`).
3. **Model Specs (optional curated UI):** each spec has required unique **`name`**; **`preset.endpoint` + `preset.model`** bind the actual backend; optional **`label`** for the header dropdown.

Azure config uses **`groups[]`** with `group`, `instanceName`, and per-model **`deploymentName`** (deployment is what Azure expects).

### Picker / display
- Default: endpoint selector + model list for that endpoint.
- With Model Specs: users can see curated **`label`** / description; `prioritize` / `enforce` change whether raw endpoint/model pickers remain available.
- Message chrome: **`modelDisplayLabel`** fallback; presets can set **`modelLabel`**. Display order documented as: custom preset name → label derived from model name → `modelDisplayLabel` (default `"AI"`).

### Display aliases
- **Yes** — Model Spec `label`, preset `modelLabel`, endpoint `modelDisplayLabel`.

### Multi-endpoint / same model ID
- Same wire model id (e.g. `gpt-4o`) on OpenRouter vs local gateway: create **two custom endpoints** with different `name`s; models live under each endpoint.
- Model Specs can present two friendly rows that both use different endpoints but similar underlying model strings.
- Azure: multiple `groups` (regions/instances) each with their own deployments.
- **Pattern:** namespace by **endpoint** (and optionally Spec id); aliases via Spec/preset labels.

---

## 6. SillyTavern

### Sources
- API Connections overview: https://docs.sillytavern.app/usage/api-connections/\
- Chat Completions / custom OpenAI-compatible: https://docs.sillytavern.app/usage/api-connections/openai/\

### Unique key
- User selects an API connection mode (Chat Completion vs Text Completion, then a vendor or **Custom OpenAI-compatible**).
- Model: from `/v1/models` dropdown if available, else **manual model ID** text field.

### Picker / display
- Connection UI + model dropdown/text field. Docs emphasize API keys, base URL (`/v1`, not `/chat/completions`), and “Test Message”.

### Display aliases
- Not documented as a first-class “display name ≠ model id” field for Chat Completions models. Connection presets exist in the product ecosystem; **primary docs reviewed do not define a LibreChat-style label layer**.

### Multi-endpoint / same model ID
- Docs describe configuring **a** custom OpenAI-compatible endpoint and selecting a model for that connection.
- **No documented `prefix_id`-style namespacing** when multiple backends expose the same id.
- **Speculation:** disambiguation is mostly “switch active connection / preset,” not a unified multi-connection model list with namespaced ids.

---

## 7. AnythingLLM

### Sources
- README (features + supported LLMs): https://github.com/Mintplex-Labs/anything-llm/blob/master/README.md\
- Azure provider source: https://github.com/Mintplex-Labs/anything-llm/blob/master/server/utils/AiProviders/azureOpenAi/index.js\
- Generic OpenAI provider source: https://github.com/Mintplex-Labs/anything-llm/blob/master/server/utils/AiProviders/genericOpenAi/index.js\
- Official docs site (`docs.anythingllm.com`) returned **HTTP 403** during this research pass — treat hosted docs as unverified here.

### Unique key
- LLM choice is **provider-centric** (OpenAI, Azure OpenAI, Ollama, OpenRouter, LiteLLM, Generic OpenAI, …), with a **model preference** string.
- Azure source comments: users name “models” as **deployments**; `AZURE_OPENAI_MODEL_PREF` must be the **deployment name**. Validity checks assume the operator typed a real deployment.
- Generic OpenAI: `GENERIC_OPEN_AI_MODEL_PREF` (or constructor `modelPreference`) is the model id sent to the compatible API.

### Picker / display
- README lists many providers; runtime UX is settings/workspace LLM configuration (details not fully confirmed without docs site access).

### Display aliases
- Not evidenced in the Azure/Generic source files reviewed (preference string = wire id / deployment name).
- README mentions [Dynamic Model Routing](https://docs.anythingllm.com/model-router/overview) (rules-based routing) — **not fetched** (403); note as product capability without schema detail here.

### Multi-endpoint / same model ID
- Architecture is “select a provider + model pref,” not a merged multi-connection catalog like Open WebUI.
- Duplicate ids across providers are separated by **switching provider**, not by namespaced composite ids in the snippets reviewed.

---

## 8. Azure OpenAI deployment names

### Sources
- Create resource / deploy model: https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/create-resource\
- LiteLLM Azure mapping: https://docs.litellm.ai/docs/providers/azure\

### Pattern
Microsoft docs (emphasis added in paraphrase):

- **Deployment name** is chosen carefully; it is what client libraries and REST APIs use.
- “When you access the model via the API, you need to refer to the **deployment name** rather than the **underlying model name**… OpenAI only requires the model name. Azure OpenAI always requires deployment name, even when using the model parameter.”
- Docs often show deployment names identical to model names for clarity, but “your deployment names can follow whatever naming convention is best for your use case.”
- Example CLI: deploy `gpt-4o` with `--deployment-name MyModel`.

LiteLLM encodes this as `azure/<deployment name>` inside `litellm_params.model`, while the proxy may advertise a friendlier `model_name`.

### Implication for gateways
Azure already **forces an operator-chosen alias** (deployment name) at the cloud layer. Gateways either:

- Pass that deployment name through as the model id, or\
- Map many deployments into one client-facing alias (LiteLLM load balancing), or\
- Group deployments by region/instance (LibreChat Azure `groups`).

---

## Cross-product patterns

### 1. Provider / author namespace in the model id
**OpenRouter** (`author/slug`), **LiteLLM** backend (`provider/model-or-deployment`), often **Open WebUI** (`prefix_id.upstream_id`).\
Makes the string globally unique *without* a second UI field.

### 2. Alias / title separate from wire id
**Continue** (`name` vs `model`), **LiteLLM** (`model_name` vs `litellm_params.model`), **LibreChat** (Spec `label` / `modelLabel`), **Open WebUI** Workspace Models (Name vs ID vs Base Model), **Azure** (deployment name vs foundation model).\
Best UX when the same wire id must appear twice with different meanings.

### 3. Connection / endpoint as the namespace
**LibreChat** custom endpoint `name`, **Open WebUI** `urlIdx` (+ optional prefix), **SillyTavern** / **AnythingLLM** active provider connection.\
Duplicate `gpt-4o` strings are OK if scoped under different endpoints.

### 4. Same alias ⇒ pool (not two rows)
**LiteLLM** and **OpenRouter** (provider routing): one selectable model id, many backends.\
Opposite of “show both Azure-West and Azure-East as separate picker rows.”

### 5. Curated façade over raw catalogs
**LibreChat Model Specs**, **Open WebUI Workspace Models**: hide messy multi-provider catalogs behind named personas that still point at a concrete endpoint+model.

### Practical recommendation synthesis (derived, not a single vendor’s rule)
For a multi-connection chat product that must show the same upstream id twice:

| Goal | Common approach |
| --- | --- |
| One logical model, many backends | Shared alias + load balance / provider routing (LiteLLM, OpenRouter) |
| Two selectable rows, same wire id | Unique display key + retain wire id (Continue `name`, LibreChat Spec, OWUI `prefix_id` or Workspace Model) |
| Azure | Treat **deployment name** as the wire id; never assume it equals the foundation model name |

---

## Gaps / speculation explicitly marked

| Topic | Status |
| --- | --- |
| Open WebUI behavior when two connections return the same id **without** `prefix_id` | **Speculation** — prefixing is clearly supported; collision semantics not fully traced in docs |
| SillyTavern multi-connection unified picker | **Not documented** in sources reviewed |
| AnythingLLM hosted docs / model-router schema | **Blocked (HTTP 403)**; README + provider source only |
| OpenRouter variant docs page content | Variants confirmed via Models API (`:free`) and models guide (`:free`, `:thinking`); full variants guide HTML not fully extracted |

---

## Source index

1. https://openrouter.ai/docs/guides/overview/models\
2. https://openrouter.ai/docs/guides/routing/provider-selection\
3. https://openrouter.ai/api/v1/models\
4. https://docs.litellm.ai/docs/proxy/configs\
5. https://docs.litellm.ai/docs/providers/openai_compatible\
6. https://docs.litellm.ai/docs/providers/azure\
7. https://docs.litellm.ai/docs/routing\
8. https://docs.openwebui.com/features/workspace/models/\
9. https://docs.openwebui.com/getting-started/quick-start/\
10. https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/openai.py\
11. https://github.com/open-webui/open-webui/blob/main/backend/open_webui/utils/model_ids.py\
12. https://docs.continue.dev/reference\
13. https://docs.continue.dev/customize/model-providers/overview\
14. https://www.librechat.ai/docs/quick_start/custom_endpoints\
15. https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint\
16. https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/model_specs\
17. https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/azure_openai\
18. https://docs.sillytavern.app/usage/api-connections/\
19. https://docs.sillytavern.app/usage/api-connections/openai/\
20. https://github.com/Mintplex-Labs/anything-llm/blob/master/README.md\
21. https://github.com/Mintplex-Labs/anything-llm/blob/master/server/utils/AiProviders/azureOpenAi/index.js\
22. https://github.com/Mintplex-Labs/anything-llm/blob/master/server/utils/AiProviders/genericOpenAi/index.js\
23. https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/create-resource\
