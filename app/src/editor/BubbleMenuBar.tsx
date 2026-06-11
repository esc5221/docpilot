import { BubbleMenu, type Editor } from "@tiptap/react";

interface Props {
  editor: Editor;
  /** Open the ⌘K inline-edit popover for the current selection. */
  onAiEdit: () => void;
}

/** Formatting bubble over a markdown selection — plus the AI edit entry point. */
export function BubbleMenuBar({ editor, onAiEdit }: Props) {
  const btn = (
    label: React.ReactNode,
    title: string,
    active: boolean,
    run: () => void,
  ) => (
    <button
      className={`dp-bubble-btn ${active ? "is-on" : ""}`}
      title={title}
      onMouseDown={(e) => {
        e.preventDefault(); // keep the editor selection
        run();
      }}
    >
      {label}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 120, placement: "top", maxWidth: "none" }}
      shouldShow={({ editor: ed, state }) => ed.isEditable && !state.selection.empty}
    >
      <div className="dp-bubble">
        <button
          className="dp-bubble-btn dp-bubble-ai"
          title="Edit with AI (⌘K)"
          onMouseDown={(e) => {
            e.preventDefault();
            onAiEdit();
          }}
        >
          ✦ AI Edit
        </button>
        <span className="dp-bubble-sep" />
        {btn(<b>B</b>, "Bold", editor.isActive("bold"), () =>
          editor.chain().focus().toggleBold().run(),
        )}
        {btn(<i>I</i>, "Italic", editor.isActive("italic"), () =>
          editor.chain().focus().toggleItalic().run(),
        )}
        {btn(<s>S</s>, "Strikethrough", editor.isActive("strike"), () =>
          editor.chain().focus().toggleStrike().run(),
        )}
        {btn(<code>{"<>"}</code>, "Inline code", editor.isActive("code"), () =>
          editor.chain().focus().toggleCode().run(),
        )}
        <span className="dp-bubble-sep" />
        {btn("H1", "Heading 1", editor.isActive("heading", { level: 1 }), () =>
          editor.chain().focus().toggleHeading({ level: 1 }).run(),
        )}
        {btn("H2", "Heading 2", editor.isActive("heading", { level: 2 }), () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
        )}
        {btn("H3", "Heading 3", editor.isActive("heading", { level: 3 }), () =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(),
        )}
        <span className="dp-bubble-sep" />
        {btn("❝", "Blockquote", editor.isActive("blockquote"), () =>
          editor.chain().focus().toggleBlockquote().run(),
        )}
        {btn("•", "Bullet list", editor.isActive("bulletList"), () =>
          editor.chain().focus().toggleBulletList().run(),
        )}
        {btn("1.", "Numbered list", editor.isActive("orderedList"), () =>
          editor.chain().focus().toggleOrderedList().run(),
        )}
      </div>
    </BubbleMenu>
  );
}
