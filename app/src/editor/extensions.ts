import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { PendingHighlight } from "./PendingHighlight";

/** The editor's extension stack. Markdown in/out + the AI target highlight. */
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
      placeholder: "여기에 글을 쓰거나 .md 파일을 열어보세요. 문장을 선택하고 ⌘K.",
    }),
    PendingHighlight,
  ];
}
