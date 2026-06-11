import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const searchKey = new PluginKey("searchHighlight");

export interface SearchMeta {
  /** All match ranges in the document. */
  ranges: { from: number; to: number }[];
  /** Index of the active match (stronger highlight). */
  activeIndex: number;
}

/**
 * Find-in-document highlights, controlled via transaction metadata:
 * a SearchMeta to show matches, `null` to clear.
 */
export const SearchHighlight = Extension.create({
  name: "searchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(searchKey) as SearchMeta | null | undefined;
            if (meta === null) return DecorationSet.empty;
            if (meta) {
              return DecorationSet.create(
                tr.doc,
                meta.ranges.map((r, i) =>
                  Decoration.inline(r.from, r.to, {
                    class: i === meta.activeIndex ? "dp-search-hit is-active" : "dp-search-hit",
                  }),
                ),
              );
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return searchKey.getState(state);
          },
        },
      }),
    ];
  },
});
