import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const pendingKey = new PluginKey("pendingHighlight");

export interface PendingMeta {
  from: number;
  to: number;
}

/**
 * Highlights the range the AI is currently working on, so the user keeps sight
 * of the target even while the popover holds focus. Controlled via transaction
 * metadata: `{ from, to }` to set, `null` to clear.
 */
export const PendingHighlight = Extension.create({
  name: "pendingHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pendingKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(pendingKey) as PendingMeta | null | undefined;
            if (meta === null) return DecorationSet.empty;
            if (meta) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.from, meta.to, { class: "dp-pending" }),
              ]);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return pendingKey.getState(state);
          },
        },
      }),
    ];
  },
});
