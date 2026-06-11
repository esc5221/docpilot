import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { FlashHighlight } from "./FlashHighlight";
import { SearchHighlight } from "./SearchHighlight";

/** The editor's extension stack. Markdown in/out + anchor flash + find. */
export function buildExtensions() {
  return [
    StarterKit,
    Markdown.configure({
      html: false,
      linkify: true,
      breaks: true,
      transformPastedText: true,
    }),
    Placeholder.configure({
      placeholder: "Start writing — select text and press ⌘K to edit with AI.",
    }),
    FlashHighlight,
    SearchHighlight,
  ];
}
