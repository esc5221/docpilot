import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

/** The editor's extension stack. Markdown in/out. */
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
  ];
}
