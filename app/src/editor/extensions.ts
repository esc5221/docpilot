import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { FlashHighlight } from "./FlashHighlight";

/** The editor's extension stack. Markdown in/out + anchor flash. */
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
      placeholder: "Start writing, or open a .md file.",
    }),
    FlashHighlight,
  ];
}
