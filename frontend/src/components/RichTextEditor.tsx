import { BoldOutlined, ItalicOutlined, LinkOutlined, UnderlineOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Input, Space, Tooltip, message } from "antd";
import { useEffect, useRef, useState } from "react";

type Props = {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
};

export function RichTextEditor({ value, onChange, placeholder }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [linkInputVisible, setLinkInputVisible] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  useEffect(() => {
    if (editorRef.current && value !== undefined && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const emitChange = () => {
    if (!onChange || !editorRef.current) return;
    onChange(editorRef.current.innerHTML);
  };

  const applyCommand = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf("image") === 0) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          insertHtmlAtCursor(`<img class="rte-img" src="${reader.result}" alt="pasted image" />`);
          emitChange();
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    event.preventDefault();
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        insertHtmlAtCursor(`<img class="rte-img" src="${reader.result}" alt="dropped image" />`);
        emitChange();
      };
      reader.readAsDataURL(file);
    });
  };

  const insertHtmlAtCursor = (html: string) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    sel.getRangeAt(0).deleteContents();
    const range = sel.getRangeAt(0);
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const frag = document.createDocumentFragment();
    let node: ChildNode | null = null;
    let lastNode: ChildNode | null = null;
    while ((node = temp.firstChild)) {
      lastNode = frag.appendChild(node);
    }
    range.insertNode(frag);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const handleLinkAdd = () => {
    if (!linkValue) return;
    applyCommand("createLink", linkValue);
    setLinkInputVisible(false);
    setLinkValue("");
  };

  return (
    <div className="rich-editor">
      <Space size={6} wrap>
        <Tooltip title="Bold">
          <Button size="small" icon={<BoldOutlined />} onClick={() => applyCommand("bold")} />
        </Tooltip>
        <Tooltip title="Italic">
          <Button size="small" icon={<ItalicOutlined />} onClick={() => applyCommand("italic")} />
        </Tooltip>
        <Tooltip title="Underline">
          <Button size="small" icon={<UnderlineOutlined />} onClick={() => applyCommand("underline")} />
        </Tooltip>
        <Tooltip title="Link">
          <Button size="small" icon={<LinkOutlined />} onClick={() => setLinkInputVisible((v) => !v)} />
        </Tooltip>
        <Tooltip title="Paste image from clipboard">
          <Button size="small" icon={<PictureOutlined />} onClick={() => message.info("Copy image then paste (Ctrl/Cmd+V) in editor")} />
        </Tooltip>
        {linkInputVisible && (
          <Input
            size="small"
            placeholder="https://"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onPressEnter={handleLinkAdd}
            style={{ width: 200 }}
          />
        )}
      </Space>
      <div
        ref={editorRef}
        className="rich-editor-area"
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={emitChange}
        onPaste={handlePaste}
        onDrop={handleDrop}
        data-placeholder={placeholder}
      />
    </div>
  );
}
