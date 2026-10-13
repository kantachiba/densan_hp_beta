/**
 * note 風エディタのクライアント処理。
 * - 文字選択でバブルメニュー（見出し・太字・リンクなど）
 * - 空行の「＋」からブロック挿入（画像・見出し・リスト・引用・コード・区切り線）
 * - 画像のドラッグ＆ドロップ / ペースト / ファイル選択でアップロード
 * - 画像を選ぶと専用ツールバー（幅・配置・トリミング）、トリミング中は画像をドラッグして位置調整
 * - 下書きの自動保存、Ctrl/⌘+S 保存、未保存での離脱警告
 */
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { BubbleMenu } from "@tiptap/extension-bubble-menu";
import { FloatingMenu } from "@tiptap/extension-floating-menu";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import { ArticleImage } from "./editor-image.ts";
import {
  normalizeFocus,
  normalizeLayout,
  normalizeZoom,
  WIDTH_MAX,
  WIDTH_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../lib/image-layout.ts";

type Status = "draft" | "published";

interface InitialData {
  articleId: string | null;
  title: string;
  content: JSONContent | null;
  thumbnailUrl: string | null;
  thumbnailFocusX: number;
  thumbnailFocusY: number;
  category: string;
  tags: string[];
  status: Status;
  updatedAt: string | null;
  limits: { tagMax: number; tagsPerArticle: number };
}

const AUTOSAVE_DELAY = 3000;
const MAX_UPLOAD = 10 * 1024 * 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initEditor(): void {
  const data = JSON.parse($("editor-data").textContent ?? "{}") as InitialData;

  const state = {
    articleId: data.articleId,
    status: data.status,
    thumbnailUrl: data.thumbnailUrl,
    thumbnailFocusX: normalizeFocus(data.thumbnailFocusX),
    thumbnailFocusY: normalizeFocus(data.thumbnailFocusY),
    tags: [...data.tags],
    baseUpdatedAt: data.updatedAt,
    dirty: false,
    saving: false,
    pendingSave: false,
  };

  /* ============================================================
     UI 要素
     ============================================================ */
  const titleEl = $<HTMLTextAreaElement>("title");
  const saveStateEl = $("save-state");
  const statusBadge = $("status-badge");
  const previewLink = $<HTMLAnchorElement>("preview-link");
  const saveDraftBtn = $<HTMLButtonElement>("save-draft");
  const openPublishBtn = $<HTMLButtonElement>("open-publish");
  const toastEl = $("toast");
  const dropOverlay = $("drop-overlay");

  const dialog = $<HTMLDialogElement>("publish-dialog");
  const categoryEl = $<HTMLInputElement>("category");
  const tagInput = $<HTMLInputElement>("tag-input");
  const tagList = $("tag-list");
  const publishError = $("publish-error");
  const publishBtn = $<HTMLButtonElement>("publish");
  const unpublishBtn = $<HTMLButtonElement>("unpublish");
  const dialogDraftBtn = $<HTMLButtonElement>("dialog-draft");

  /* ============================================================
     トースト
     ============================================================ */
  let toastTimer: number | undefined;
  function toast(message: string, isError = false, ms = 2600): void {
    toastEl.textContent = message;
    toastEl.classList.toggle("is-error", isError);
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    if (ms > 0) toastTimer = window.setTimeout(() => (toastEl.hidden = true), ms);
  }

  /* ============================================================
     画像アップロード
     ============================================================ */
  async function upload(file: File): Promise<string | null> {
    if (!file.type.startsWith("image/")) {
      toast("画像ファイルを選択してください", true);
      return null;
    }
    if (file.size > MAX_UPLOAD) {
      toast("画像は10MB以下にしてください", true);
      return null;
    }
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/uploads", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "アップロードに失敗しました");
      return json.url as string;
    } catch (err) {
      toast(err instanceof Error ? err.message : "アップロードに失敗しました", true, 4000);
      return null;
    }
  }

  const imageFiles = (list: FileList | null | undefined) =>
    Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));

  async function insertImages(files: File[], pos?: number): Promise<void> {
    if (!files.length) return;
    toast(`画像をアップロード中…（${files.length}枚）`, false, 0);
    let insertAt = pos;
    let inserted = 0;
    for (const file of files) {
      const src = await upload(file);
      if (!src) continue;
      const alt = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
      const chain = editor.chain().focus();
      if (insertAt !== undefined) {
        chain.insertContentAt(insertAt, { type: "image", attrs: { src, alt } }).run();
        insertAt = editor.state.selection.to;
      } else {
        chain.setImage({ src, alt }).run();
      }
      inserted++;
    }
    if (inserted) toast(`画像を${inserted}枚挿入しました`);
  }

  /* ============================================================
     エディタ本体
     ============================================================ */
  const bubbleEl = $("bubble-menu");
  const floatingEl = $("floating-menu");
  const imageMenuEl = $("image-menu");
  // Tiptap は表示時に appendTo へ挿入し、非表示時に DOM から外す前提
  bubbleEl.remove();
  floatingEl.remove();
  imageMenuEl.remove();

  const editor = new Editor({
    element: $("editor"),
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
        },
      }),
      ArticleImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === "heading" ? "見出し" : "ご自由にお書きください。"),
      }),
      BubbleMenu.configure({
        element: bubbleEl,
        pluginKey: "formatMenu",
        appendTo: () => document.body,
        options: { placement: "top", offset: 10 },
        shouldShow: ({ editor: ed, state: st, from, to }) => {
          if (bubbleEl.contains(document.activeElement)) return true;
          if (!ed.view.hasFocus() || from === to) return false;
          if (st.selection instanceof NodeSelection) return false;
          return !ed.isActive("codeBlock");
        },
      }),
      BubbleMenu.configure({
        element: imageMenuEl,
        pluginKey: "imageMenu",
        appendTo: () => document.body,
        options: { placement: "bottom", offset: 12 },
        shouldShow: ({ state: st }) =>
          st.selection instanceof NodeSelection && st.selection.node.type.name === "image",
      }),
      FloatingMenu.configure({
        element: floatingEl,
        pluginKey: "blockMenu",
        appendTo: () => document.body,
        // 左の余白が足りない画面幅では行の右側に出す
        options: { placement: "left", offset: 14, flip: { fallbackPlacements: ["right"] }, shift: false },
      }),
    ],
    content: data.content ?? "",
    editorProps: {
      attributes: { "aria-label": "本文", spellcheck: "true" },
      handleDrop: (view, event, _slice, moved) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (moved || !files.length) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void insertImages(files, coords?.pos);
        return true;
      },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
    },
    onUpdate: () => markDirty(),
    onSelectionUpdate: () => {
      syncBubble();
      syncImageMenu();
      closeBlockMenu();
    },
    onTransaction: () => syncBubble(),
  });

  /* ---- バブルメニュー（書式） ---- */
  const formatRow = bubbleEl.querySelector<HTMLElement>('[data-row="format"]')!;
  const linkRow = bubbleEl.querySelector<HTMLFormElement>('[data-row="link"]')!;
  const linkInput = linkRow.querySelector<HTMLInputElement>("input")!;

  const activeChecks: Record<string, () => boolean> = {
    h2: () => editor.isActive("heading", { level: 2 }),
    h3: () => editor.isActive("heading", { level: 3 }),
    bold: () => editor.isActive("bold"),
    italic: () => editor.isActive("italic"),
    strike: () => editor.isActive("strike"),
    code: () => editor.isActive("code"),
    link: () => editor.isActive("link"),
    quote: () => editor.isActive("blockquote"),
  };

  function syncBubble(): void {
    formatRow.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((btn) => {
      btn.classList.toggle("is-active", activeChecks[btn.dataset.cmd!]?.() ?? false);
    });
  }

  function showLinkRow(show: boolean): void {
    formatRow.hidden = show;
    linkRow.hidden = !show;
    if (show) {
      linkInput.value = (editor.getAttributes("link").href as string | undefined) ?? "";
      requestAnimationFrame(() => linkInput.focus());
    }
  }

  bubbleEl.addEventListener("mousedown", (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  });

  // commands.focus は次フレームで選択範囲を復元するため、フォーカス済みなら呼ばない
  const chainFocused = () => (editor.view.hasFocus() ? editor.chain() : editor.chain().focus());

  bubbleEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-cmd]");
    if (!btn) return;
    const chain = chainFocused();
    switch (btn.dataset.cmd) {
      case "h2": chain.toggleHeading({ level: 2 }).run(); break;
      case "h3": chain.toggleHeading({ level: 3 }).run(); break;
      case "bold": chain.toggleBold().run(); break;
      case "italic": chain.toggleItalic().run(); break;
      case "strike": chain.toggleStrike().run(); break;
      case "code": chain.toggleCode().run(); break;
      case "quote": chain.toggleBlockquote().run(); break;
      case "link": showLinkRow(true); return;
      case "unlink":
        chain.extendMarkRange("link").unsetLink().run();
        showLinkRow(false);
        return;
    }
    syncBubble();
  });

  linkRow.addEventListener("submit", (e) => {
    e.preventDefault();
    let href = linkInput.value.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetLink().run();
    else {
      if (!/^(https?:|mailto:|\/|#)/i.test(href)) href = `https://${href}`;
      chain.setLink({ href }).run();
    }
    showLinkRow(false);
  });

  linkInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      showLinkRow(false);
      editor.commands.focus();
    }
  });

  editor.on("blur", () => {
    if (!bubbleEl.contains(document.activeElement)) showLinkRow(false);
  });

  /* ---- 「＋」ブロックメニュー ---- */
  const plusBtn = floatingEl.querySelector<HTMLButtonElement>("#plus")!;
  const blockMenu = floatingEl.querySelector<HTMLElement>("#block-menu")!;
  const imageInput = $<HTMLInputElement>("image-input");

  function closeBlockMenu(): void {
    blockMenu.hidden = true;
    plusBtn.setAttribute("aria-expanded", "false");
  }

  floatingEl.addEventListener("mousedown", (e) => e.preventDefault());
  plusBtn.addEventListener("click", () => {
    const open = blockMenu.hidden;
    blockMenu.hidden = !open;
    plusBtn.setAttribute("aria-expanded", String(open));
  });

  blockMenu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-block]");
    if (!btn) return;
    const chain = chainFocused();
    switch (btn.dataset.block) {
      case "image": imageInput.click(); break;
      case "h2": chain.setHeading({ level: 2 }).run(); break;
      case "h3": chain.setHeading({ level: 3 }).run(); break;
      case "bullet": chain.toggleBulletList().run(); break;
      case "ordered": chain.toggleOrderedList().run(); break;
      case "quote": chain.toggleBlockquote().run(); break;
      case "code": chain.setCodeBlock().run(); break;
      case "hr": chain.setHorizontalRule().run(); break;
    }
    closeBlockMenu();
  });

  imageInput.addEventListener("change", () => {
    void insertImages(imageFiles(imageInput.files));
    imageInput.value = "";
  });

  /* ============================================================
     画像ツールバー（幅・配置・トリミング）
     ============================================================ */
  const widthInput = imageMenuEl.querySelector<HTMLInputElement>("#img-width")!;
  const widthValue = imageMenuEl.querySelector<HTMLElement>("#img-width-value")!;
  const zoomInput = imageMenuEl.querySelector<HTMLInputElement>("#img-zoom")!;
  const zoomValue = imageMenuEl.querySelector<HTMLElement>("#img-zoom-value")!;
  const zoomRow = imageMenuEl.querySelector<HTMLElement>("#img-zoom-row")!;
  const cropHint = imageMenuEl.querySelector<HTMLElement>("#img-crop-hint")!;

  widthInput.min = String(WIDTH_MIN);
  widthInput.max = String(WIDTH_MAX);
  zoomInput.min = String(ZOOM_MIN);
  zoomInput.max = String(ZOOM_MAX);

  /** 選択中の画像ノード（選択が画像でなければ null） */
  function selectedImage() {
    const sel = editor.state.selection;
    return sel instanceof NodeSelection && sel.node.type.name === "image" ? sel.node : null;
  }

  function updateImage(attrs: Record<string, unknown>): void {
    editor.chain().updateAttributes("image", attrs).run();
  }

  function syncImageMenu(): void {
    const node = selectedImage();
    if (!node) return;
    const layout = normalizeLayout(node.attrs);
    imageMenuEl.querySelectorAll<HTMLButtonElement>("[data-img-set]").forEach((btn) => {
      const [key, value] = btn.dataset.imgSet!.split(":");
      const current = key === "align" ? layout.align : (layout.ratio ?? "");
      btn.classList.toggle("is-active", current === value);
    });
    widthInput.value = String(layout.width);
    widthValue.textContent = `${layout.width}%`;
    zoomInput.value = String(layout.zoom);
    zoomValue.textContent = `${layout.zoom}%`;
    zoomRow.hidden = !layout.ratio;
    cropHint.hidden = !layout.ratio;
  }

  // ボタン操作でエディタのフォーカス（＝画像の選択）が外れないようにする
  imageMenuEl.addEventListener("mousedown", (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  });

  imageMenuEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-img-set],[data-img-cmd]");
    if (!btn || !selectedImage()) return;
    if (btn.dataset.imgSet) {
      const [key, value] = btn.dataset.imgSet.split(":");
      updateImage(
        key === "align"
          ? { align: value }
          : { ratio: value || null, focusX: 50, focusY: 50, zoom: 100 },
      );
    } else if (btn.dataset.imgCmd === "reset") {
      updateImage({ width: WIDTH_MAX, align: "center", ratio: null, focusX: 50, focusY: 50, zoom: 100 });
    } else if (btn.dataset.imgCmd === "remove") {
      editor.chain().focus().deleteSelection().run();
      return;
    }
    syncImageMenu();
  });

  widthInput.addEventListener("input", () => {
    if (!selectedImage()) return;
    widthValue.textContent = `${widthInput.value}%`;
    updateImage({ width: Number(widthInput.value) });
  });

  zoomInput.addEventListener("input", () => {
    if (!selectedImage()) return;
    zoomValue.textContent = `${zoomInput.value}%`;
    updateImage({ zoom: Number(zoomInput.value) });
  });

  /* ---- トリミング中の画像はドラッグで表示位置を調整 ---- */
  const editorEl = $("editor");
  let pan: { figure: HTMLElement; x: number; y: number; focusX: number; focusY: number; moved: boolean } | null = null;

  editorEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const frame = (e.target as HTMLElement).closest<HTMLElement>(".a-fig__frame[data-cropped]");
    const figure = frame?.closest<HTMLElement>(".a-fig");
    if (!figure) return;
    // preventDefault はしない（この mousedown で ProseMirror に画像を選択させる）
    pan = {
      figure,
      x: e.clientX,
      y: e.clientY,
      focusX: normalizeFocus(figure.dataset.focusX),
      focusY: normalizeFocus(figure.dataset.focusY),
      moved: false,
    };
  });

  // 位置調整の最中はブロック移動のドラッグを始めさせない
  editorEl.addEventListener("dragstart", (e) => {
    if (pan) e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!pan) return;
    const rect = pan.figure.getBoundingClientRect();
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 3) return;
    pan.moved = true;
    pan.figure.classList.add("is-panning");
    // 枠の幅いっぱいのドラッグで表示位置が端から端まで動く
    const focusX = normalizeFocus(pan.focusX - (dx / rect.width) * 100);
    const focusY = normalizeFocus(pan.focusY - (dy / rect.height) * 100);
    pan.figure.style.setProperty("--img-pos", `${focusX}% ${focusY}%`);
    pan.figure.dataset.pendingX = String(focusX);
    pan.figure.dataset.pendingY = String(focusY);
  });

  window.addEventListener("mouseup", () => {
    if (!pan) return;
    const { figure, moved } = pan;
    pan = null;
    figure.classList.remove("is-panning");
    if (!moved) return;
    // ドラッグ中は DOM だけを動かし、確定時に一度だけ履歴へ積む
    const focusX = Number(figure.dataset.pendingX);
    const focusY = Number(figure.dataset.pendingY);
    if (selectedImage() && editor.view.nodeDOM(editor.state.selection.from) === figure) {
      updateImage({ focusX, focusY });
    }
  });

  editorEl.addEventListener(
    "wheel",
    (e) => {
      const frame = (e.target as HTMLElement).closest<HTMLElement>(".a-fig__frame[data-cropped]");
      const figure = frame?.closest<HTMLElement>(".a-fig");
      const node = selectedImage();
      if (!figure || !node || editor.view.nodeDOM(editor.state.selection.from) !== figure) return;
      e.preventDefault();
      const next = normalizeZoom(normalizeZoom(node.attrs.zoom) + (e.deltaY < 0 ? 10 : -10));
      updateImage({ zoom: next });
      syncImageMenu();
    },
    { passive: false },
  );

  /* ============================================================
     タイトル
     ============================================================ */
  titleEl.value = data.title;
  const autoGrow = () => {
    titleEl.style.height = "auto";
    titleEl.style.height = `${titleEl.scrollHeight}px`;
  };
  autoGrow();
  titleEl.addEventListener("input", () => {
    titleEl.value = titleEl.value.replace(/\n/g, "");
    autoGrow();
    markDirty();
  });
  titleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      // commands.focus は次フレームでフォーカスするため、直後の入力がタイトルに入らないよう同期的に移す
      const { state, view } = editor;
      view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView());
      view.focus();
    }
  });
  if (!data.title) titleEl.focus();

  /* ============================================================
     アイキャッチ画像
     ============================================================ */
  const thumbZone = $("thumb-zone");
  const thumbInput = $<HTMLInputElement>("thumb-input");
  const thumbImg = $<HTMLImageElement>("thumb-img");

  function renderThumb(): void {
    if (state.thumbnailUrl) {
      thumbImg.src = state.thumbnailUrl;
      thumbImg.style.objectPosition = `${state.thumbnailFocusX}% ${state.thumbnailFocusY}%`;
      thumbZone.removeAttribute("data-empty");
    } else {
      thumbImg.removeAttribute("src");
      thumbImg.style.removeProperty("object-position");
      thumbZone.setAttribute("data-empty", "");
    }
  }
  renderThumb();

  async function setThumbnail(file: File | undefined): Promise<void> {
    if (!file) return;
    thumbZone.classList.add("is-busy");
    const url = await upload(file);
    thumbZone.classList.remove("is-busy");
    if (!url) return;
    state.thumbnailUrl = url;
    state.thumbnailFocusX = 50;
    state.thumbnailFocusY = 50;
    renderThumb();
    markDirty();
  }

  $("thumb-add").addEventListener("click", () => thumbInput.click());
  $("thumb-change").addEventListener("click", () => thumbInput.click());
  $("thumb-remove").addEventListener("click", () => {
    state.thumbnailUrl = null;
    state.thumbnailFocusX = 50;
    state.thumbnailFocusY = 50;
    renderThumb();
    markDirty();
  });

  let thumbPan: { x: number; y: number; focusX: number; focusY: number; moved: boolean } | null = null;
  thumbImg.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !state.thumbnailUrl) return;
    e.preventDefault();
    thumbPan = {
      x: e.clientX,
      y: e.clientY,
      focusX: state.thumbnailFocusX,
      focusY: state.thumbnailFocusY,
      moved: false,
    };
  });
  window.addEventListener("mousemove", (e) => {
    if (!thumbPan) return;
    const rect = thumbImg.getBoundingClientRect();
    const dx = e.clientX - thumbPan.x;
    const dy = e.clientY - thumbPan.y;
    if (!thumbPan.moved && Math.hypot(dx, dy) < 3) return;
    thumbPan.moved = true;
    thumbZone.classList.add("is-panning");
    const focusX = normalizeFocus(thumbPan.focusX - (dx / rect.width) * 100);
    const focusY = normalizeFocus(thumbPan.focusY - (dy / rect.height) * 100);
    thumbImg.style.objectPosition = `${focusX}% ${focusY}%`;
    thumbZone.dataset.pendingX = String(focusX);
    thumbZone.dataset.pendingY = String(focusY);
  });
  window.addEventListener("mouseup", () => {
    if (!thumbPan) return;
    const moved = thumbPan.moved;
    thumbPan = null;
    thumbZone.classList.remove("is-panning");
    if (!moved) return;
    state.thumbnailFocusX = normalizeFocus(thumbZone.dataset.pendingX);
    state.thumbnailFocusY = normalizeFocus(thumbZone.dataset.pendingY);
    markDirty();
  });
  thumbInput.addEventListener("change", () => {
    void setThumbnail(thumbInput.files?.[0]);
    thumbInput.value = "";
  });
  thumbZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    thumbZone.classList.add("is-drag");
    dropOverlay.hidden = true;
  });
  thumbZone.addEventListener("dragleave", () => thumbZone.classList.remove("is-drag"));
  thumbZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    thumbZone.classList.remove("is-drag");
    dropOverlay.hidden = true;
    void setThumbnail(imageFiles(e.dataTransfer?.files)[0]);
  });

  /* ---- ページ全体へのドロップ（本文の末尾 or カーソル位置に挿入） ---- */
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    dropOverlay.hidden = false;
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.hidden = true;
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    dragDepth = 0;
    dropOverlay.hidden = true;
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    void insertImages(imageFiles(e.dataTransfer?.files));
  });

  /* ============================================================
     カテゴリ・タグ（公開設定ダイアログ）
     ============================================================ */
  categoryEl.value = data.category;
  categoryEl.addEventListener("input", markDirty);

  function renderTags(): void {
    tagList.replaceChildren(
      ...state.tags.map((tag, i) => {
        const li = document.createElement("li");
        li.className = "tag-chip";
        li.textContent = `#${tag}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `タグ「${tag}」を削除`);
        remove.addEventListener("click", () => {
          state.tags.splice(i, 1);
          renderTags();
          markDirty();
        });
        li.append(remove);
        return li;
      }),
    );
    tagInput.disabled = state.tags.length >= data.limits.tagsPerArticle;
    tagInput.placeholder = tagInput.disabled ? "タグは最大数です" : "タグを入力";
  }
  renderTags();

  function commitTag(): void {
    const parts = tagInput.value.split(/[,、\s]+/);
    for (const raw of parts) {
      const tag = raw.trim().replace(/^#+/, "").slice(0, data.limits.tagMax);
      if (!tag || state.tags.length >= data.limits.tagsPerArticle) continue;
      if (state.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
      state.tags.push(tag);
      markDirty();
    }
    tagInput.value = "";
    renderTags();
  }

  tagInput.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTag();
    } else if (e.key === "Backspace" && !tagInput.value && state.tags.length) {
      state.tags.pop();
      renderTags();
      markDirty();
    }
  });
  tagInput.addEventListener("input", () => {
    if (/[,、]/.test(tagInput.value)) commitTag();
  });
  tagInput.addEventListener("blur", commitTag);
  $("tag-box").addEventListener("click", () => tagInput.focus());

  /* ============================================================
     保存
     ============================================================ */
  let autosaveTimer: number | undefined;
  let changeSeq = 0;

  function setSaveState(text: string): void {
    saveStateEl.textContent = text;
  }

  function markDirty(): void {
    changeSeq++;
    state.dirty = true;
    setSaveState("未保存の変更があります");
    window.clearTimeout(autosaveTimer);
    // 公開中の記事は意図せず反映されないよう自動保存しない
    if (state.status === "draft") {
      autosaveTimer = window.setTimeout(() => {
        if (hasAnyContent()) void save("draft", { silent: true });
      }, AUTOSAVE_DELAY);
    }
  }

  function hasAnyContent(): boolean {
    return !!titleEl.value.trim() || !editor.isEmpty || !!state.thumbnailUrl;
  }

  function renderStatus(): void {
    const published = state.status === "published";
    statusBadge.textContent = published ? "公開中" : "下書き";
    statusBadge.className = `adm-badge adm-badge--${state.status}`;
    openPublishBtn.textContent = published ? "更新する" : "公開に進む";
    saveDraftBtn.hidden = published;
    publishBtn.textContent = published ? "更新する" : "公開する";
    unpublishBtn.hidden = !published;
    dialogDraftBtn.hidden = published;
    if (state.articleId) {
      previewLink.hidden = false;
      previewLink.href = published ? `/news/${state.articleId}` : `/admin/articles/${state.articleId}/preview`;
      previewLink.textContent = published ? "記事を見る" : "プレビュー";
    }
  }
  renderStatus();

  async function save(status: Status, opts: { silent?: boolean } = {}): Promise<boolean> {
    commitTag();
    if (state.saving) {
      state.pendingSave = true;
      return false;
    }
    window.clearTimeout(autosaveTimer);
    state.saving = true;
    setSaveState("保存中…");
    [saveDraftBtn, openPublishBtn, publishBtn, unpublishBtn, dialogDraftBtn].forEach((b) => (b.disabled = true));

    // 保存中に入力された変更は dirty のまま残す
    const seqAtSave = changeSeq;
    const payload = {
      title: titleEl.value.trim(),
      content: editor.getJSON(),
      thumbnailUrl: state.thumbnailUrl,
      thumbnailFocusX: state.thumbnailFocusX,
      thumbnailFocusY: state.thumbnailFocusY,
      category: categoryEl.value.trim(),
      tags: state.tags,
      status,
      baseUpdatedAt: state.baseUpdatedAt,
    };

    try {
      const res = await fetch(state.articleId ? `/api/articles/${state.articleId}` : "/api/articles", {
        method: state.articleId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("ログインの有効期限が切れました。別タブでログインしてから再度保存してください");
      if (!res.ok) throw new Error(json.error ?? `保存に失敗しました（${res.status}）`);

      const article = json.article as { articleId: string; status: Status; updatedAt: string };
      const created = !state.articleId;
      state.articleId = article.articleId;
      state.status = article.status;
      state.baseUpdatedAt = article.updatedAt;
      if (changeSeq === seqAtSave) state.dirty = false;
      if (created) history.replaceState(null, "", `/admin/articles/${article.articleId}/edit`);
      renderStatus();
      const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      setSaveState(state.dirty ? "未保存の変更があります" : `${time} に保存しました`);
      if (!opts.silent && status === "draft") toast("下書きを保存しました");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存に失敗しました";
      setSaveState("保存できませんでした");
      if (dialog.open) {
        publishError.textContent = message;
        publishError.hidden = false;
      } else {
        toast(message, true, 5000);
      }
      return false;
    } finally {
      state.saving = false;
      [saveDraftBtn, openPublishBtn, publishBtn, unpublishBtn, dialogDraftBtn].forEach((b) => (b.disabled = false));
      if (state.pendingSave) {
        state.pendingSave = false;
        if (state.dirty && state.status === "draft") void save("draft", { silent: true });
      }
    }
  }

  saveDraftBtn.addEventListener("click", () => void save("draft"));

  /* ---- 公開ダイアログ ---- */
  const settingsStep = dialog.querySelector<HTMLElement>('[data-step="settings"]')!;
  const doneStep = dialog.querySelector<HTMLElement>('[data-step="done"]')!;

  openPublishBtn.addEventListener("click", () => {
    publishError.hidden = true;
    settingsStep.hidden = false;
    doneStep.hidden = true;
    dialog.showModal();
  });

  dialog.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-close]") || e.target === dialog) dialog.close();
  });

  publishBtn.addEventListener("click", async () => {
    publishError.hidden = true;
    const wasPublished = state.status === "published";
    if (!(await save("published"))) return;
    if (wasPublished) {
      dialog.close();
      toast("記事を更新しました");
      return;
    }
    const url = new URL(`/news/${state.articleId}`, location.origin).href;
    $<HTMLAnchorElement>("done-view").href = url;
    $<HTMLAnchorElement>("done-share").href =
      `https://x.com/intent/post?${new URLSearchParams({ text: titleEl.value.trim(), url })}`;
    settingsStep.hidden = true;
    doneStep.hidden = false;
  });

  dialogDraftBtn.addEventListener("click", async () => {
    if (await save("draft")) dialog.close();
  });

  unpublishBtn.addEventListener("click", async () => {
    if (!confirm("記事を非公開にして下書きに戻しますか？公開ページは表示されなくなります。")) return;
    if (await save("draft", { silent: true })) {
      dialog.close();
      toast("非公開（下書き）に戻しました");
    }
  });

  /* ---- ショートカット・離脱警告 ---- */
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save(state.status);
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty || state.saving) {
      e.preventDefault();
    }
  });
}
