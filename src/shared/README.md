# Shared list client

This client connects the existing catalog, map, and personal-list UI to the shared list Worker in `shared-worker/README.md`. Shared data is held separately from the personal list and budget.

## Deployment configuration

The Worker is source code in this repository; no production API URL is configured here and the Worker has not been deployed. The UI is available only when the build has a valid `VITE_SHARED_LIST_API_URL` HTTPS origin (HTTP is accepted for localhost). With the variable unset or invalid, the shared-list controls are omitted. For local development, set it in an untracked `.env.local`, for example `VITE_SHARED_LIST_API_URL=http://localhost:8787`.

Deploy `shared-worker/wrangler.jsonc` to Cloudflare with its SQLite Durable Object migration, then set `ALLOWED_ORIGINS` to the exact origin of the site. Cloudflare Worker hosting and the Durable Object are required for shared rooms to work. For GitHub Pages, set the repository Actions variable `VITE_SHARED_LIST_API_URL` to the Worker origin to enable the UI. This repository does not deploy or configure a production Worker.

Pass the deployed Worker origin explicitly as `apiUrl` when creating a room or client. It must be an HTTPS origin such as `https://shared-api.example`; HTTP is accepted only for localhost development. The client has no default API host and never puts a room key in an API URL. For local use, follow the Wrangler instructions in `shared-worker/README.md` and pass `http://localhost:8787`.

## Room links and credentials

Create a room and share a link:

```ts
import { createSharedRoom, createSharedRoomUrl } from "./shared/index.ts";

const apiUrl = "https://shared-api.example";
const room = await createSharedRoom(apiUrl);
const shareUrl = createSharedRoomUrl(window.location.href, room);
```

The link has `?room=<roomId>#<roomKey>`. The app captures the fragment before reading the tab fragment, saves the key to this tab's `sessionStorage`, and removes it from the visible URL:

```ts
import { captureSharedRoomLink } from "./shared/index.ts";

const credentials = captureSharedRoomLink(
  new URL(window.location.href),
  window.sessionStorage,
  (cleanUrl) => window.history.replaceState(null, "", cleanUrl),
);
```

Call this before the current app reads or rewrites the URL fragment. The existing UI uses the fragment for tab selection. After creating a room or accepting a pasted link, keep only the room ID in the current URL:

```ts
import { createSharedRoomRouteUrl } from "./shared/index.ts";

window.history.replaceState(null, "", createSharedRoomRouteUrl(window.location.href, credentials.roomId));
```

On a later page load in the same tab, call `readSharedRoomCredentials(roomId, window.sessionStorage)` using the non-secret `room` query value. When the participant returns to the personal list, pass `null` to `createSharedRoomRouteUrl` to remove that query and avoid reconnecting on reload. If the tab storage is cleared, the participant needs the original shared link again.

The room key is kept in tab-scoped `sessionStorage`, sent only as `Authorization: Bearer ...`, and is not included in the operation outbox. Do not log room credentials, request headers, or complete share links. The fragment is hidden from HTTP requests and Referer headers, but any JavaScript running on the page can read it before it is captured.

## Sync and pending operations

```ts
import { SharedListClient } from "./shared/index.ts";

const client = new SharedListClient({ apiUrl, ...credentials });
const unsubscribe = client.subscribe((snapshot) => {
  // Render snapshot.state, snapshot.status, snapshot.pendingOperations, and snapshot.error.
});
const stopPolling = client.startPolling(5_000);

await client.enqueue({ type: "set-budget", budgetYen: 5_000 });
```

The client saves each operation, with its base revision and a local operation ID, to `localStorage` before waiting for sync. A later operation is persisted while an earlier request is still in flight, so a reload restores both. Sync and recovery requests remain serialized. Each tab gets a separate outbox, identified by a value in that tab's `sessionStorage`; a reload in the same tab restores its pending operations. The client also holds a Web Lock for the tab ID across its rooms. If a duplicated tab or `window.open` inherits the same session ID, the lock collision gives it a new ID and empty outbox, leaving the original tab's queue untouched. If Web Locks or either storage is unavailable, the client blocks sending and reports an error. A network failure leaves the operation in the outbox for the next poll or `sync()` call. A successful server response removes it. The outbox never contains the room key. Keep one client per room per tab and call `dispose()` when the client instance is no longer needed; also stop polling and unsubscribe UI listeners when the owning view is disposed. The previous room-wide outbox format is copied under a room-wide migration lock.

Requests have a 15-second timeout, including response-body reading. Set `requestTimeoutMs` in the client options to use a different positive timeout. A timeout leaves the operation queued because the server may already have applied it.

The Worker has no operation ID or deduplication API. If a request may have reached the server but its response was lost, the next sync compares the saved base revision with the latest state. A changed revision stops automatic sending and reports `status: "conflict"`; no pending operation is silently replayed. After reviewing the latest state and `conflict.operations`, `resolveConflict("rebase")` retries the whole queue against the latest revision, while `resolveConflict("discard")` removes the whole queue.

To resolve only the first pending operation, pass its ID from the same snapshot to `resolvePendingOperation`:

```ts
const operationId = snapshot.pendingOperationIds?.[0];
if (operationId) await client.resolvePendingOperation("mark-applied", operationId);
```

The client serializes this recovery with syncs and other queue changes. It checks that the selected ID is still at the head before acting; a stale choice is rejected without touching the next operation. Each choice first fetches the latest state, then rebases the remaining queue on its revision. Use `mark-applied` only after checking that the operation's intended effect is already present; for example, an added item with the same ID may have been committed before its response was lost. `discard` removes only that first operation. The later operations remain queued and continue in order. `retryPending()` retries after a temporary API error; `discardPending()` remains available to clear the whole outbox.

The shared-list screen shows connection state, queued operations, and conflicts. For a conflict, resolve operations in queue order with `resolvePendingOperation`: confirm `mark-applied` only after checking the latest shared state, use `retry` to rebase the queue, or explicitly discard an operation. Polling uses ordinary GET requests and stops when the shared-list view is inactive. The client never writes to the personal list's storage key; the UI keeps shared items and budget in a separate store mode.
