/**
 * 本文の画像ノード。標準の Image に幅・配置・トリミングの属性を足し、
 * 公開ページ（src/lib/server/content.ts の renderDoc）と同じ DOM 構造で描画する。
 * エディタ上の見た目と公開後の見た目を一致させるのが狙い。
 */
import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";
import {
  DEFAULT_LAYOUT,
  layoutStyle,
  normalizeAlign,
  normalizeFocus,
  normalizeLayout,
  normalizeRatio,
  normalizeWidth,
  normalizeZoom,
} from "../lib/image-layout.ts";

export const ArticleImage = Image.extend({
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: DEFAULT_LAYOUT.width, parseHTML: (el) => normalizeWidth(el.dataset.width) },
      align: { default: DEFAULT_LAYOUT.align, parseHTML: (el) => normalizeAlign(el.dataset.align) },
      ratio: { default: null, parseHTML: (el) => normalizeRatio(el.dataset.ratio) },
      focusX: { default: 50, parseHTML: (el) => normalizeFocus(el.dataset.focusX) },
      focusY: { default: 50, parseHTML: (el) => normalizeFocus(el.dataset.focusY) },
      zoom: { default: DEFAULT_LAYOUT.zoom, parseHTML: (el) => normalizeZoom(el.dataset.zoom) },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure.a-fig",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const img = el.querySelector("img");
          const src = img?.getAttribute("src");
          if (!img || !src) return false;
          return {
            src,
            alt: img.getAttribute("alt"),
            ...normalizeLayout({
              width: el.dataset.width,
              align: el.dataset.align,
              ratio: el.dataset.ratio,
              focusX: el.dataset.focusX,
              focusY: el.dataset.focusY,
              zoom: el.dataset.zoom,
            }),
          };
        },
      },
      { tag: this.options.allowBase64 ? "img[src]" : 'img[src]:not([src^="data:"])' },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const layout = normalizeLayout(node.attrs);
    const style = layoutStyle(layout);
    const imgAttrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      width: null,
      height: null,
      align: null,
      ratio: null,
      focusX: null,
      focusY: null,
      zoom: null,
    });
    return [
      "figure",
      {
        class: "a-fig",
        "data-align": layout.align,
        "data-width": String(layout.width),
        ...(layout.ratio ? { "data-ratio": layout.ratio } : {}),
        "data-focus-x": String(layout.focusX),
        "data-focus-y": String(layout.focusY),
        "data-zoom": String(layout.zoom),
        ...(style ? { style } : {}),
      },
      ["div", { class: "a-fig__frame", ...(layout.ratio ? { "data-cropped": "" } : {}) }, ["img", imgAttrs]],
    ];
  },
});
