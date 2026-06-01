import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const flashKey = new PluginKey("flashHighlight");

/**
 * Transient highlight for "jump to this region" (anchor flash). Controlled via
 * transaction metadata: `{ from, to }` to show, `null` to clear.
 */
export const FlashHighlight = Extension.create({
  name: "flashHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: flashKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(flashKey) as { from: number; to: number } | null | undefined;
            if (meta === null) return DecorationSet.empty;
            if (meta) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.from, meta.to, { class: "dp-flash" }),
              ]);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return flashKey.getState(state);
          },
        },
      }),
    ];
  },
});
