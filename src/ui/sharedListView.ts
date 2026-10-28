import { products } from "../data.ts";
import type { SharedListState, SharedOperation, SharedRoomCredentials, SharedSyncSnapshot } from "../shared/index.ts";
import {
  SharedListClient,
  captureSharedRoomLink,
  createSharedRoom,
  createSharedRoomRouteUrl,
  createSharedRoomUrl,
} from "../shared/index.ts";
import { projectSharedCart, sharedOperationsForCartChange } from "../shared/bridge.ts";
import { createSharedPollingController } from "../shared/polling.ts";
import type { AppStore } from "../store.ts";
import { button, el } from "./dom.ts";

export type SharedListViewOptions = {
  apiUrl: string;
  initialCredentials: SharedRoomCredentials | null;
  initialError: string | null;
  roomLinkNeedsPaste: boolean;
};

export type SharedListView = {
  element: HTMLElement;
  setActive: (active: boolean) => void;
};

const emptySnapshot: SharedSyncSnapshot = {
  state: null,
  status: "idle",
  pendingOperations: [],
  conflict: null,
  error: null,
};

function operationLabel(operation: SharedOperation, snapshot: SharedSyncSnapshot): string {
  if (operation.type === "add") return "追加: " + operation.item.name + " × " + operation.item.quantity;
  if (operation.type === "set-budget") {
    return "予算: " + (operation.budgetYen === null ? "なし" : operation.budgetYen.toLocaleString("ja-JP") + "円");
  }
  const sharedItem = snapshot.state?.items.find((item) => item.id === operation.itemId);
  const product = products.find((item) => item.id === sharedItem?.productId || item.id === operation.itemId);
  const name = sharedItem?.name ?? product?.name ?? "共有商品";
  if (operation.type === "remove") return "削除: " + name;
  if (operation.type === "set-quantity") return "数量変更: " + name + " × " + operation.quantity;
  return (operation.purchased ? "購入済みに変更: " : "未購入に変更: ") + name;
}

function operationAlreadyApplied(operation: SharedOperation, state: SharedListState | null): boolean {
  if (!state) return false;
  if (operation.type === "add") {
    const item = state.items.find((entry) => entry.id === operation.item.id);
    return item !== undefined
      && item.productId === operation.item.productId
      && item.name === operation.item.name
      && item.priceYen === operation.item.priceYen
      && item.quantity === operation.item.quantity
      && !item.purchased;
  }
  if (operation.type === "remove") return !state.items.some((item) => item.id === operation.itemId);
  if (operation.type === "set-quantity") {
    return state.items.find((item) => item.id === operation.itemId)?.quantity === operation.quantity;
  }
  if (operation.type === "set-purchased") {
    return state.items.find((item) => item.id === operation.itemId)?.purchased === operation.purchased;
  }
  return state.budgetYen === operation.budgetYen;
}

export function sharedListView(store: AppStore, options: SharedListViewOptions): SharedListView {
  const element = el("section", "shared-list-panel");
  element.setAttribute("aria-labelledby", "shared-list-heading");
  const heading = el("h3", "shared-list-heading", "共同リスト");
  heading.id = "shared-list-heading";
  const status = el("p", "shared-list-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const error = el("p", "shared-list-error");
  error.setAttribute("role", "alert");
  const controls = el("div", "shared-list-controls");
  const createButton = button("共同リストを作成", "button button-primary shared-create");
  const joinToggle = button("共有リンクから参加", "button button-secondary shared-join-toggle");
  controls.append(createButton, joinToggle);

  const joinForm = el("form", "shared-join-form");
  joinForm.hidden = true;
  const joinLabel = el("label", "shared-link-field");
  joinLabel.append(el("span", "field-label", "共有リンク"));
  const joinInput = el("input", "text-input shared-link-input");
  joinInput.type = "url";
  joinInput.required = true;
  joinInput.autocomplete = "off";
  joinInput.spellcheck = false;
  joinInput.setAttribute("aria-label", "参加する共同リストの共有リンク");
  joinInput.placeholder = "https://…/?room=…#…";
  joinLabel.append(joinInput);
  const joinSubmit = button("このリストに参加", "button button-primary", "submit");
  const joinCancel = button("キャンセル", "button button-secondary");
  joinForm.append(joinLabel, joinSubmit, joinCancel);

  const activeControls = el("div", "shared-list-active-controls");
  activeControls.hidden = true;
  const copyLinkButton = button("共有リンクをコピー", "button button-secondary");
  const syncButton = button("今すぐ同期", "button button-secondary");
  const retryButton = button("未送信の操作を再試行", "button button-secondary");
  const leaveButton = button("個人リストに戻る", "button button-secondary");
  const resumeButton = button("共有リストを表示", "button button-primary");
  resumeButton.hidden = true;
  activeControls.append(copyLinkButton, syncButton, retryButton, leaveButton, resumeButton);
  const copyFallback = el("textarea", "shared-link-fallback");
  copyFallback.hidden = true;
  copyFallback.readOnly = true;
  copyFallback.autocomplete = "off";
  copyFallback.spellcheck = false;
  copyFallback.setAttribute("aria-label", "コピーする共同リストの共有リンク");
  const copyStatus = el("p", "shared-copy-status");
  copyStatus.setAttribute("aria-live", "polite");

  const pendingPanel = el("div", "shared-pending-panel");
  pendingPanel.hidden = true;
  const pendingHeading = el("h4", "shared-pending-heading");
  const pendingList = el("ul", "shared-pending-list");
  pendingPanel.append(pendingHeading, pendingList);
  const resolutionControls = el("div", "shared-resolution-controls");
  const firstOperation = el("p", "shared-first-operation");
  const markAppliedButton = button("反映済みとして確認", "button button-secondary");
  const retryFirstButton = button("この操作から順に再送", "button button-primary");
  const discardFirstButton = button("先頭の操作だけ破棄", "button button-danger");
  const rebaseButton = button("すべて最新状態へ再適用", "button button-secondary");
  const discardAllButton = button("保留操作をすべて破棄", "button button-danger");
  const discardUnsavedButton = button("端末に保存できなかった変更を取り消す", "button button-danger");
  resolutionControls.append(firstOperation, markAppliedButton, retryFirstButton, discardFirstButton, rebaseButton, discardAllButton, discardUnsavedButton);
  pendingPanel.append(resolutionControls);
  const confirmPanel = el("div", "shared-confirm-panel");
  confirmPanel.hidden = true;
  const confirmText = el("p", "shared-confirm-text");
  const confirmAction = button("続ける", "button button-danger");
  const cancelAction = button("キャンセル", "button button-secondary");
  confirmPanel.append(confirmText, confirmAction, cancelAction);

  element.append(heading, status, error, controls, joinForm, activeControls, copyFallback, copyStatus, pendingPanel, confirmPanel);

  let client: SharedListClient | null = null;
  let unsubscribe: (() => void) | null = null;
  let snapshot = emptySnapshot;
  let credentials = options.initialCredentials;
  let itemIds = new Map<string, string>();
  let wantsSharedList = false;
  let isBusy = false;
  let localError = options.initialError;
  let unsupportedState = false;
  let enqueueing = 0;
  let unsavedChanges: string[] = [];
  let confirmKind: "leave" | "resolve-rebase" | "resolve-discard" | "resolve-first-discard" | "mark-applied" | "discard-pending" | "discard-unsaved" | null = null;

  const setPolling = createSharedPollingController(() => client!.startPolling(5_000));
  const pendingCount = () => snapshot.pendingOperations.length;
  const updatePolling = () => {
    setPolling(client !== null && wantsSharedList);
  };

  const render = () => {
    const isInSharedList = wantsSharedList && store.isShared();
    createButton.hidden = isInSharedList || options.initialCredentials !== null;
    joinToggle.hidden = isInSharedList || options.initialCredentials !== null;
    joinForm.hidden = isInSharedList || options.initialCredentials !== null || !joinForm.dataset.open;
    activeControls.hidden = !client;
    copyLinkButton.disabled = !credentials;
    syncButton.disabled = !client || isBusy;
    retryButton.hidden = snapshot.status !== "offline" || pendingCount() === 0;
    retryButton.disabled = isBusy;
    leaveButton.hidden = !isInSharedList;
    leaveButton.disabled = isBusy;
    resumeButton.hidden = !client || isInSharedList;
    resumeButton.disabled = isBusy;
    createButton.disabled = isBusy || !canSwitchRoom();
    joinToggle.disabled = isBusy || !canSwitchRoom();
    joinSubmit.disabled = isBusy || !canSwitchRoom();

    if (unsupportedState) {
      status.textContent = "この共有リストには現在のカタログで表示できない商品があります。個人リストを表示しています。共有データは変更していません。";
    } else if (!client) {
      status.textContent = options.roomLinkNeedsPaste
        ? "共有リンクの鍵がこのタブにありません。元の共有リンクを貼り付けてください。"
        : "共同リストを作成するか、共有リンクから参加できます。";
    } else if (!wantsSharedList) {
      status.textContent = pendingCount() || unsavedChanges.length
        ? "個人リストを表示中です。共同リストの保留操作は破棄せず、この端末に残しています。"
        : "個人リストを表示中です。共有リストへ戻れます。";
    } else if (!snapshot.state) {
      status.textContent = snapshot.status === "syncing" ? "共有リストに接続しています…" : "共有リストの状態を取得できていません。個人リストは変更していません。";
    } else if (snapshot.status === "conflict") {
      status.textContent = "別の端末で更新されています。保留中の操作を確認してから解決してください。";
    } else if (snapshot.status === "offline") {
      status.textContent = "接続が切れています。保留中の操作はこの端末に保存しています。";
    } else if (snapshot.status === "error") {
      status.textContent = snapshot.error?.message ?? "共有リストを編集できません。";
    } else if (snapshot.status === "syncing") {
      status.textContent = "共有リストを同期しています…";
    } else {
      status.textContent = "共有リストは同期済みです。";
    }

    const visibleError = localError ?? (unsavedChanges.length > 0
      ? "端末に保存できなかった変更が " + unsavedChanges.length + " 件あります。共有先には送信していません。"
      : snapshot.error?.message ?? "");
    error.textContent = visibleError;
    error.hidden = !visibleError;

    const operations = [...snapshot.pendingOperations];
    pendingPanel.hidden = operations.length === 0 && unsavedChanges.length === 0;
    pendingHeading.textContent = unsavedChanges.length > 0
      ? "保留中の操作 " + operations.length + " 件・端末に保存できなかった変更 " + unsavedChanges.length + " 件"
      : "未送信の操作 " + operations.length + " 件";
    pendingList.replaceChildren(
      ...operations.map((operation) => el("li", "shared-pending-item", operationLabel(operation, snapshot))),
      ...unsavedChanges.map((description) => el("li", "shared-pending-item", "未保存: " + description)),
    );
    resolutionControls.hidden = operations.length === 0 && unsavedChanges.length === 0;
    firstOperation.textContent = operations.length > 0
      ? "次に解決する操作（1 / " + operations.length + "）：" + operationLabel(operations[0], snapshot)
      : "";
    markAppliedButton.hidden = operations.length === 0 || !operationAlreadyApplied(operations[0], snapshot.state);
    retryFirstButton.hidden = operations.length === 0;
    discardFirstButton.hidden = operations.length === 0;
    rebaseButton.hidden = snapshot.status !== "conflict" || operations.length === 0;
    discardAllButton.hidden = operations.length === 0;
    discardUnsavedButton.hidden = unsavedChanges.length === 0;
    rebaseButton.disabled = isBusy;
    discardAllButton.disabled = isBusy;
    discardUnsavedButton.disabled = isBusy;
    markAppliedButton.disabled = isBusy;
    retryFirstButton.disabled = isBusy;
    discardFirstButton.disabled = isBusy;

    if (confirmKind) {
      confirmPanel.hidden = false;
      if (confirmKind === "leave") {
        const leaveNotices = [
          pendingCount() > 0 ? "未送信の操作 " + pendingCount() + " 件は端末に保存したままです。" : "",
          enqueueing > 0 ? "送信中の操作 " + enqueueing + " 件は端末に保存済みです。" : "",
          unsavedChanges.length > 0 ? "端末に保存できなかった変更 " + unsavedChanges.length + " 件は共有先に届いていません。個人リストへ戻ると共有画面から見えなくなります。" : "",
        ].filter(Boolean).join(" ");
        confirmText.textContent = leaveNotices + " 個人リストへ戻りますか？";
        confirmAction.textContent = "個人リストに戻る";
      } else if (confirmKind === "resolve-rebase") {
        confirmText.textContent = "保留中の " + pendingCount() + " 件すべてを、最新の共有状態へ順番に再適用します。よろしいですか？";
        confirmAction.textContent = "すべて再適用する";
      } else if (confirmKind === "mark-applied") {
        confirmText.textContent = "最新の共有状態を再取得し、先頭の操作が反映済みと確認できた場合だけ、その操作をキューから外します。よろしいですか？";
        confirmAction.textContent = "反映済みとして続ける";
      } else if (confirmKind === "resolve-first-discard") {
        confirmText.textContent = "先頭の操作だけを破棄し、残り " + Math.max(0, pendingCount() - 1) + " 件は最新状態へつなぎ直して残します。よろしいですか？";
        confirmAction.textContent = "先頭の操作を破棄する";
      } else if (confirmKind === "discard-unsaved") {
        confirmText.textContent = "端末に保存できなかった変更 " + unsavedChanges.length + " 件を共有画面から取り消し、最新の共有状態を表示します。よろしいですか？";
        confirmAction.textContent = "未保存の変更を取り消す";
      } else {
        const count = pendingCount();
        confirmText.textContent = "保留中の操作 " + count + " 件を端末から削除します。この操作は取り消せません。続けますか？";
        confirmAction.textContent = "操作をすべて破棄する";
      }
    } else {
      confirmPanel.hidden = true;
    }
  };

  function canSwitchRoom(): boolean {
    return pendingCount() === 0 && unsavedChanges.length === 0 && enqueueing === 0;
  }

  const applySnapshot = (next: SharedSyncSnapshot) => {
    snapshot = next;
    if (wantsSharedList && enqueueing === 0 && unsavedChanges.length === 0 && next.state) {
      const pending = next.status === "conflict" || next.status === "error" ? [] : next.pendingOperations;
      const projection = projectSharedCart(next.state, pending);
      if (!projection) {
        unsupportedState = true;
        wantsSharedList = false;
        store.setSharedChangeHandler(null);
        store.setSharedWriteBlocked(false);
        store.leaveSharedList();
      } else {
        itemIds = projection.itemIds;
        if (store.isShared()) store.applySharedList(projection.items, projection.budget);
        else store.enterSharedList(projection.items, projection.budget);
        store.setSharedWriteBlocked(next.status === "conflict" || next.status === "error");
      }
    } else if (wantsSharedList && store.isShared() && next.status === "error") {
      store.setSharedWriteBlocked(true);
    }
    updatePolling();
    render();
  };

  const connect = (nextCredentials: SharedRoomCredentials, initialState?: SharedListState) => {
    if (client && !canSwitchRoom()) {
      localError = "未送信の操作が残っているため、別のルームへ切り替えられません。先に同期または競合を解決してください。";
      render();
      return;
    }
    setPolling(false);
    unsubscribe?.();
    client = null;
    unsubscribe = null;
    snapshot = emptySnapshot;
    itemIds = new Map();
    credentials = nextCredentials;
    wantsSharedList = true;
    unsupportedState = false;
    localError = null;
    unsavedChanges = [];
    enqueueing = 0;
    store.setSharedChangeHandler(handleSharedChange);
    try {
      client = new SharedListClient({ apiUrl: options.apiUrl, ...nextCredentials });
      unsubscribe = client.subscribe(applySnapshot);
      if (initialState) {
        const projection = projectSharedCart(initialState);
        if (!projection) {
          unsupportedState = true;
          wantsSharedList = false;
          localError = "この共有リストには現在のカタログで表示できない商品があります。";
        } else {
          itemIds = projection.itemIds;
          store.enterSharedList(projection.items, projection.budget);
          store.setSharedWriteBlocked(client.getSnapshot().status === "error");
        }
      }
      updatePolling();
      render();
    } catch {
      wantsSharedList = false;
      store.setSharedChangeHandler(null);
      store.setSharedWriteBlocked(false);
      store.leaveSharedList();
      localError = "共有ルームに接続できませんでした。API URLと共有リンクを確認してください。";
      updatePolling();
      render();
    }
  };

  const handleSharedChange = (previous: ReturnType<AppStore["getState"]>, next: ReturnType<AppStore["getState"]>) => {
    if (!client || !wantsSharedList || store.isSharedWriteBlocked()) return;
    let operations: SharedOperation[];
    try {
      operations = sharedOperationsForCartChange(
        { items: previous.items, budget: previous.budget },
        { items: next.items, budget: next.budget },
        itemIds,
      );
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : "共有操作を作成できませんでした。";
      unsavedChanges.push(cause instanceof Error ? cause.message : "共有操作を作成できませんでした。");
      store.setSharedWriteBlocked(true);
      render();
      return;
    }
    enqueueing += operations.length;
    for (const operation of operations) {
      if (operation.type === "add") itemIds.set(operation.item.productId ?? "", operation.item.id);
      if (operation.type === "remove") {
        for (const [productId, itemId] of itemIds) if (itemId === operation.itemId) itemIds.delete(productId);
      }
      void client.enqueue(operation).then(() => {
        enqueueing -= 1;
        if (enqueueing === 0) applySnapshot(client?.getSnapshot() ?? snapshot);
      }, () => {
        enqueueing -= 1;
        unsavedChanges.push(operationLabel(operation, snapshot));
        localError = "未送信の変更を端末に保存できませんでした。画面に表示したまま保持しています。";
        store.setSharedWriteBlocked(true);
        render();
      });
    }
    render();
  };

  const saveLinkCredentials = (shareUrl: string): boolean => {
    try {
      return captureSharedRoomLink(new URL(shareUrl), window.sessionStorage, () => {}) !== null;
    } catch {
      return false;
    }
  };

  const updateCurrentRoomRoute = (roomId: string | null) => {
    const route = createSharedRoomRouteUrl(window.location.href, roomId);
    window.history.replaceState(null, "", route);
  };

  const createRoom = async () => {
    if (!canSwitchRoom()) return;
    isBusy = true;
    localError = null;
    render();
    try {
      const room = await createSharedRoom(options.apiUrl);
      const nextCredentials = { roomId: room.roomId, roomKey: room.roomKey };
      const shareUrl = createSharedRoomUrl(window.location.href, nextCredentials);
      if (!saveLinkCredentials(shareUrl)) {
        localError = "鍵をこのタブに保存できませんでした。共有リンクをコピーして保管してください。";
      }
      updateCurrentRoomRoute(nextCredentials.roomId);
      connect(nextCredentials, room.state);
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : "共有ルームを作成できませんでした。";
    } finally {
      isBusy = false;
      render();
    }
  };

  const joinRoom = () => {
    joinInput.setCustomValidity("");
    let parsed: URL;
    try {
      parsed = new URL(joinInput.value.trim());
    } catch {
      joinInput.setCustomValidity("共有リンク全体を貼り付けてください。");
      joinInput.reportValidity();
      return;
    }
    try {
      if (parsed.origin !== window.location.origin) throw new Error("このサイトで作成した共有リンクを貼り付けてください。");
      const nextCredentials = captureSharedRoomLink(parsed, window.sessionStorage, () => {});
      if (!nextCredentials) throw new Error("共有リンクにルームIDまたは鍵がありません。");
      credentials = nextCredentials;
      if (!saveLinkCredentials(createSharedRoomUrl(window.location.href, nextCredentials))) {
        localError = "鍵をこのタブに保存できませんでした。このタブを閉じる前に共有リンクを保管してください。";
      }
      updateCurrentRoomRoute(nextCredentials.roomId);
      joinForm.dataset.open = "";
      joinForm.hidden = true;
      joinInput.value = "";
      connect(nextCredentials);
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : "共有リンクを読み取れませんでした。";
    }
    render();
  };

  const copyLink = async () => {
    if (!credentials) return;
    const link = createSharedRoomUrl(window.location.href, credentials);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(link);
      copyFallback.hidden = true;
      copyFallback.value = "";
      copyStatus.textContent = "共有リンクをコピーしました。参加者だけに送ってください。";
    } catch {
      copyFallback.value = link;
      copyFallback.hidden = false;
      copyFallback.focus();
      copyFallback.select();
      copyStatus.textContent = "自動コピーできませんでした。選択した共有リンクをコピーしてください。鍵を含むため参加者だけに共有してください。";
    }
  };

  const showConfirmation = (kind: NonNullable<typeof confirmKind>) => {
    confirmKind = kind;
    render();
  };

  const resolveConflict = async (action: "rebase" | "discard") => {
    if (!client) return;
    isBusy = true;
    if (store.isShared()) store.setSharedWriteBlocked(true);
    confirmKind = null;
    localError = null;
    render();
    try {
      await client.resolveConflict(action);
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : "競合を解決できませんでした。保留操作は残しています。";
    } finally {
      isBusy = false;
      applySnapshot(client?.getSnapshot() ?? snapshot);
    }
  };

  const resolveFirstOperation = async (action: "retry" | "discard" | "mark-applied") => {
    if (!client) return;
    isBusy = true;
    if (store.isShared()) store.setSharedWriteBlocked(true);
    confirmKind = null;
    localError = null;
    render();
    try {
      if (action === "mark-applied") {
        const requestedOperation = client.getSnapshot().pendingOperations[0];
        if (!requestedOperation) throw new Error("確認する保留操作がありません。");
        await client.sync();
        const latest = client.getSnapshot();
        snapshot = latest;
        const operation = latest.pendingOperations[0];
        if (!operation && operationAlreadyApplied(requestedOperation, latest.state)) return;
        if (!operation || !operationAlreadyApplied(operation, latest.state)) {
          throw new Error("最新の共有状態で操作の結果を確認できませんでした。保留操作は残しています。");
        }
      }
      await client.resolvePendingOperation(action);
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : "先頭の操作を解決できませんでした。保留操作は残しています。";
    } finally {
      isBusy = false;
      applySnapshot(client?.getSnapshot() ?? snapshot);
    }
  };

  const discardPending = async () => {
    if (!client) return;
    isBusy = true;
    if (store.isShared()) store.setSharedWriteBlocked(true);
    confirmKind = null;
    localError = null;
    render();
    try {
      await client.discardPending();
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : "保留操作を破棄できませんでした。操作は残しています。";
    } finally {
      isBusy = false;
      applySnapshot(client?.getSnapshot() ?? snapshot);
    }
  };

  const retryPending = async () => {
    if (!client) return;
    isBusy = true;
    if (store.isShared()) store.setSharedWriteBlocked(true);
    localError = null;
    render();
    try {
      await client.retryPending();
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : "未送信の操作を再試行できませんでした。操作は残しています。";
    } finally {
      isBusy = false;
      applySnapshot(client?.getSnapshot() ?? snapshot);
    }
  };

  const leaveShared = () => {
    confirmKind = null;
    wantsSharedList = false;
    updateCurrentRoomRoute(null);
    store.setSharedChangeHandler(null);
    store.setSharedWriteBlocked(false);
    store.leaveSharedList();
    updatePolling();
    render();
  };

  const discardUnsavedChanges = () => {
    unsavedChanges = [];
    localError = null;
    confirmKind = null;
    store.setSharedWriteBlocked(false);
    applySnapshot(client?.getSnapshot() ?? snapshot);
  };

  createButton.addEventListener("click", () => { void createRoom(); });
  joinToggle.addEventListener("click", () => {
    joinForm.dataset.open = joinForm.dataset.open ? "" : "true";
    joinForm.hidden = !joinForm.dataset.open;
    if (!joinForm.hidden) joinInput.focus();
  });
  joinCancel.addEventListener("click", () => {
    joinForm.dataset.open = "";
    joinForm.hidden = true;
    joinInput.value = "";
  });
  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    joinRoom();
  });
  copyLinkButton.addEventListener("click", () => { void copyLink(); });
  syncButton.addEventListener("click", () => {
    if (client) void client.sync().catch(() => undefined);
  });
  retryButton.addEventListener("click", () => { void retryPending(); });
  leaveButton.addEventListener("click", () => {
    if (pendingCount() || unsavedChanges.length || enqueueing) showConfirmation("leave");
    else leaveShared();
  });
  resumeButton.addEventListener("click", () => {
    if (!client) return;
    wantsSharedList = true;
    if (credentials) updateCurrentRoomRoute(credentials.roomId);
    unsupportedState = false;
    localError = null;
    store.setSharedChangeHandler(handleSharedChange);
    applySnapshot(client.getSnapshot());
    updatePolling();
  });
  rebaseButton.addEventListener("click", () => showConfirmation("resolve-rebase"));
  markAppliedButton.addEventListener("click", () => showConfirmation("mark-applied"));
  retryFirstButton.addEventListener("click", () => { void resolveFirstOperation("retry"); });
  discardFirstButton.addEventListener("click", () => showConfirmation("resolve-first-discard"));
  discardAllButton.addEventListener("click", () => {
    showConfirmation(snapshot.status === "conflict" ? "resolve-discard" : "discard-pending");
  });
  discardUnsavedButton.addEventListener("click", () => showConfirmation("discard-unsaved"));
  confirmAction.addEventListener("click", () => {
    if (confirmKind === "leave") leaveShared();
    else if (confirmKind === "resolve-rebase") void resolveConflict("rebase");
    else if (confirmKind === "resolve-discard") void resolveConflict("discard");
    else if (confirmKind === "resolve-first-discard") void resolveFirstOperation("discard");
    else if (confirmKind === "mark-applied") void resolveFirstOperation("mark-applied");
    else if (confirmKind === "discard-unsaved") discardUnsavedChanges();
    else if (confirmKind === "discard-pending") void discardPending();
  });
  cancelAction.addEventListener("click", () => {
    confirmKind = null;
    render();
  });

  if (options.initialCredentials) connect(options.initialCredentials);
  else if (options.roomLinkNeedsPaste) joinForm.dataset.open = "true";
  render();

  return {
    element,
    setActive() {
      updatePolling();
    },
  };
}
