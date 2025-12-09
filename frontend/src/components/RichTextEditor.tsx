import { BoldOutlined, ItalicOutlined, LinkOutlined, UnderlineOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Input, Space, Tooltip, message } from "antd";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { API_BASE } from "../api";

type Props = {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  onUploadImage?: (file: File) => Promise<string>;
  rewriteAzureAttachments?: boolean;
};

export type RichTextEditorHandle = {
  insertHtml: (html: string) => void;
  focus: () => void;
};

const isAzureAttachmentUrl = (url: string) => /dev\.azure\.com/i.test(url) && url.includes("_apis/wit/attachments");

const toProxyUrl = (url: string) => `${API_BASE}/api/attachments/proxy?url=${encodeURIComponent(url)}`;

const convertHtmlForEditor = (html: string) => {
  if (!html) return "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (!src) return;
      if (isAzureAttachmentUrl(src)) {
        if (!img.getAttribute("data-original-src")) {
          img.setAttribute("data-original-src", src);
        }
        img.setAttribute("src", toProxyUrl(src));
      }
    });
    return doc.body.innerHTML;
  } catch {
    return html;
  }
};

const convertHtmlForSave = (html: string) => {
  if (!html) return "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("img").forEach((img) => {
      const original = img.getAttribute("data-original-src");
      if (original) {
        img.setAttribute("src", original);
        img.removeAttribute("data-original-src");
      }
    });
    return doc.body.innerHTML;
  } catch {
    return html;
  }
};

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { value, onChange, placeholder, onUploadImage, rewriteAzureAttachments = true },
  ref
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [linkInputVisible, setLinkInputVisible] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  useEffect(() => {
    if (editorRef.current && value !== undefined) {
      const nextHtml = rewriteAzureAttachments ? convertHtmlForEditor(value) : value;
      if (editorRef.current.innerHTML !== nextHtml) {
        editorRef.current.innerHTML = nextHtml;
      }
    }
  }, [value, rewriteAzureAttachments]);

  const emitChange = () => {
    if (!onChange || !editorRef.current) return;
    const html = rewriteAzureAttachments ? convertHtmlForSave(editorRef.current.innerHTML) : editorRef.current.innerHTML;
    onChange(html);
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
        if (onUploadImage) {
          onUploadImage(file)
            .then((url) => {
              insertHtmlAtCursor(`<img class="rte-img" src="${url}" alt="pasted image" />`);
              emitChange();
            })
            .catch((err) => {
              console.error(err);
              message.error(err?.message || "Image upload failed");
            });
        } else {
          const reader = new FileReader();
          reader.onload = () => {
            insertHtmlAtCursor(`<img class="rte-img" src="${reader.result}" alt="pasted image" />`);
            emitChange();
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    event.preventDefault();
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      if (onUploadImage) {
        onUploadImage(file)
          .then((url) => {
            insertHtmlAtCursor(`<img class="rte-img" src="${url}" alt="dropped image" />`);
            emitChange();
          })
          .catch((err) => {
            console.error(err);
            message.error(err?.message || "Image upload failed");
          });
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          insertHtmlAtCursor(`<img class="rte-img" src="${reader.result}" alt="dropped image" />`);
          emitChange();
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const insertHtmlAtCursor = (html: string) => {
    const content = rewriteAzureAttachments ? convertHtmlForEditor(html) : html;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    sel.getRangeAt(0).deleteContents();
    const range = sel.getRangeAt(0);
    const temp = document.createElement("div");
    temp.innerHTML = content;
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

  useImperativeHandle(ref, () => ({
    insertHtml: (html: string) => {
      insertHtmlAtCursor(html);
      emitChange();
    },
    focus: () => {
      editorRef.current?.focus();
    },
  }));

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
});
