// Markdown import (Node). The converter is in markdown.js (mirrored by src/php/Markdown.php).
import { markdownToHtml } from "./markdown.js";

export default {
  contracts: {
    "import.file": {
      /**
       * Implements contract import.file, operation convert (dispatch: accepts .md, .markdown).
       *
       * Converts the file to HTML (front matter title, if any, becomes the title) for core to split into pages.
       *
       * @param {object} ctx    Platform context (spec/13).
       * @param {object} input  { name, data (base64), method, type, parentId }.
       * @returns {Promise<object>}  { html, title? } or { error }.
       */
      async convert(ctx, input) {
        const text = Buffer.from(String(input.data || ""), "base64").toString("utf8");
        if (!text.trim()) return { error: "the file is empty" };
        const { html, title } = markdownToHtml(text);
        return { html, ...(title ? { title } : {}) };
      },
    },
  },
};
