import React, { useEffect, useImperativeHandle, forwardRef, useRef, useState } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Mark, mergeAttributes, Node } from '@tiptap/core';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Video as VideoIcon,
  Undo,
  Redo,
  AlignLeft,
  AlignCenter,
  AlignRight,
  FileText,
  Highlighter
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Custom Video extension for Tiptap
const Video = Node.create({
  name: 'video',

  group: 'block',

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      controls: {
        default: true,
      },
      width: {
        default: '100%',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video',
        getAttrs: (element) => {
          if (typeof element === 'string') return false;
          return {
            src: element.getAttribute('src'),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, {
      class: 'max-w-full h-auto rounded-lg my-4',
      controls: 'true',
      src: HTMLAttributes.src,
    })];
  },

  addCommands() {
    return {
      setVideo: (options: { src: string }) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: options,
        });
      },
    };
  },
});

const HighlightMark = Mark.create({
  name: 'highlightBg',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: el => el.getAttribute('data-bg-color'),
        renderHTML: attrs => {
          if (!attrs.color) return {};
          return { 'data-bg-color': attrs.color, style: `background-color: ${attrs.color}; padding: 0 2px; border-radius: 2px;` };
        },
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-bg-color]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0]; },
  addCommands() {
    return {
      setHighlightBg: (color: string) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetHighlightBg: () => ({ commands }) => commands.unsetMark(this.name),
    } as any;
  },
});

// Custom text size extension for inline formatting
const TextSize = Mark.create({
  name: 'textSize',

  addOptions() {
    return {
      types: ['textStyle'],
    };
  },

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: element => element.getAttribute('data-size'),
        renderHTML: attributes => {
          if (!attributes.size) {
            return {};
          }
          return {
            'data-size': attributes.size,
            style: `font-size: ${attributes.size}; font-weight: bold;`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-size]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextSize: (size: string) => ({ commands }) => {
        return commands.setMark(this.name, { size });
      },
      toggleTextSize: (size: string) => ({ commands, editor }) => {
        const isActive = editor.isActive(this.name, { size });
        if (isActive) {
          return commands.unsetMark(this.name);
        }
        return commands.setMark(this.name, { size });
      },
      unsetTextSize: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      },
    };
  },
});

interface TiptapEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  editable?: boolean;
  adminId: string;
  theme?: 'dark' | 'light';
}

export interface TiptapEditorRef {
  insertImage: (url: string) => void;
  insertVideo: (url: string) => void;
  getEditor: () => Editor | null;
  getContent: () => string;
}

const TiptapEditor = forwardRef<TiptapEditorRef, TiptapEditorProps>(({
  content,
  onChange,
  placeholder = 'Start typing your announcement...',
  editable = true,
  adminId,
  theme = 'dark'
}, ref) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  const isInitialMount = useRef(true);
  const isSyncing = useRef(false);
  const [, forceUpdate] = useState({});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        },
        paragraph: {
          HTMLAttributes: {
            class: 'my-2'
          }
        },
        bulletList: {
          keepMarks: false,
          keepAttributes: false,
          HTMLAttributes: {
            class: 'list-disc pl-6'
          }
        },
        orderedList: {
          keepMarks: false,
          keepAttributes: false,
          HTMLAttributes: {
            class: 'list-decimal pl-6'
          }
        },
        listItem: {
          HTMLAttributes: {
            class: 'ml-0'
          }
        },
        codeBlock: false
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg my-4'
        }
      }),
      Video,
      Placeholder.configure({
        placeholder
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TextStyle,
      Color,
      TextSize,
      HighlightMark
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      if (!isSyncing.current) {
        const html = editor.getHTML();
        onChange(html);
      }
    },
    onSelectionUpdate: () => {
      // Force re-render to update button states
      forceUpdate({});
    },
    editorProps: {
      attributes: {
        class: `prose ${theme === 'light' ? '' : 'prose-invert'} prose-slate max-w-none focus:outline-none min-h-[300px] px-4 py-3`
      }
    },
    parseOptions: {
      preserveWhitespace: 'full'
    },
    immediatelyRender: true,
    editorReady: true
  });

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          class: `prose ${theme === 'light' ? '' : 'prose-invert'} prose-slate max-w-none focus:outline-none min-h-[300px] px-4 py-3`
        }
      }
    });
  }, [editor, theme]);

  useEffect(() => {
    if (!editor) return;

    // Skip on initial mount - content is already set in useEditor
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Only update if content is significantly different
    const currentHTML = editor.getHTML();
    const normalizedCurrent = currentHTML.replace(/>\s+</g, '><').trim();
    const normalizedNew = content.replace(/>\s+</g, '><').trim();

    if (normalizedNew !== normalizedCurrent && content !== '') {
      isSyncing.current = true;

      editor.commands.setContent(content, false);

      // Focus editor immediately after content update so toolbar buttons work
      setTimeout(() => {
        if (editor && !editor.isDestroyed) {
          editor.commands.focus('end');
          // Force focus by triggering a selection
          const { from, to } = editor.state.selection;
          editor.view.focus();
          editor.commands.setTextSelection({ from, to });
        }
        isSyncing.current = false;
      }, 100);
    }
  }, [content, editor]);

  const uploadFileWithProgress = async (
    file: File,
    fileName: string,
    bucketName: string,
    onProgress: (progress: number, loaded: number, total: number) => void
  ): Promise<{ data: any; error: any }> => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      let startTime = Date.now();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          onProgress(percentComplete, e.loaded, e.total);
        }
      });

      xhr.upload.addEventListener('loadstart', () => {
        startTime = Date.now();
        onProgress(0, 0, file.size);
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100, file.size, file.size);
          resolve({ data: { path: fileName }, error: null });
        } else {
          resolve({ data: null, error: { message: xhr.statusText } });
        }
      });

      xhr.addEventListener('error', () => {
        resolve({ data: null, error: { message: 'Upload failed' } });
      });

      xhr.open('POST', `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${bucketName}/${fileName}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.send(file);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    console.log('Image upload triggered, files:', files);

    if (!files || files.length === 0) {
      console.log('No files selected');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStatus(`Uploading ${files.length} image(s)...`);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const baseProgress = (i / files.length) * 100;
        const fileProgressRange = 100 / files.length;

        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
        console.log(`Processing file: ${file.name}, type: ${file.type}, size: ${fileSizeMB}MB`);
        setUploadStatus(`Uploading image ${i + 1}/${files.length}: ${file.name} (${fileSizeMB}MB)`);

        if (!file.type.startsWith('image/')) {
          console.log('File type rejected:', file.type);
          setUploadStatus(`Error: ${file.name} is not an image`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        if (file.size > 10 * 1024 * 1024) {
          console.log('File too large:', file.size);
          setUploadStatus(`Error: ${file.name} exceeds 10MB`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        const fileExt = file.name.split('.').pop();
        const fileName = `${adminId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        console.log('Uploading to storage:', fileName);

        const { data: uploadData, error: uploadError } = await uploadFileWithProgress(
          file,
          fileName,
          'announcement-images',
          (fileProgress, loaded, total) => {
            const totalProgress = baseProgress + (fileProgress / 100) * fileProgressRange;
            setUploadProgress(Math.round(totalProgress));
            const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
            const totalMB = (total / (1024 * 1024)).toFixed(2);
            setUploadStatus(`Uploading image ${i + 1}/${files.length}: ${file.name} - ${loadedMB}MB / ${totalMB}MB (${fileProgress}%)`);;
          }
        );

        console.log('Upload result:', { uploadData, uploadError });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          setUploadStatus(`Error uploading ${file.name}: ${uploadError.message}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('announcement-images')
          .getPublicUrl(fileName);

        console.log('Public URL:', publicUrl);

        if (editor) {
          console.log('Inserting image into editor');
          editor.chain().focus().setImage({ src: publicUrl }).run();
        }
      }

      setUploadProgress(100);
      setUploadStatus('Upload complete!');
      setTimeout(() => {
        setUploadStatus('');
        setUploadProgress(0);
      }, 2000);
    } catch (error: any) {
      console.error('Error uploading image:', error);
      setUploadStatus(`Error: ${error.message}`);
      setTimeout(() => {
        setUploadStatus('');
        setUploadProgress(0);
      }, 3000);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImageButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    console.log('Video upload triggered, files:', files);

    if (!files || files.length === 0) {
      console.log('No files selected');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStatus(`Uploading ${files.length} video(s)...`);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const baseProgress = (i / files.length) * 100;
        const fileProgressRange = 100 / files.length;

        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
        console.log(`Processing file: ${file.name}, type: ${file.type}, size: ${fileSizeMB}MB`);
        setUploadStatus(`Uploading video ${i + 1}/${files.length}: ${file.name} (${fileSizeMB}MB)`);

        if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
          console.log('File type rejected:', file.type);
          setUploadStatus(`Error: ${file.name} is not a video or image`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        if (file.size > 100 * 1024 * 1024) {
          console.log('File too large:', file.size);
          setUploadStatus(`Error: ${file.name} exceeds 100MB`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        const fileExt = file.name.split('.').pop();
        const fileName = `${adminId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        console.log('Uploading to storage:', fileName);

        const { data: uploadData, error: uploadError } = await uploadFileWithProgress(
          file,
          fileName,
          'announcement-images',
          (fileProgress, loaded, total) => {
            const totalProgress = baseProgress + (fileProgress / 100) * fileProgressRange;
            setUploadProgress(Math.round(totalProgress));
            const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
            const totalMB = (total / (1024 * 1024)).toFixed(2);
            setUploadStatus(`Uploading video ${i + 1}/${files.length}: ${file.name} - ${loadedMB}MB / ${totalMB}MB (${fileProgress}%)`);;
          }
        );

        console.log('Upload result:', { uploadData, uploadError });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          setUploadStatus(`Error uploading ${file.name}: ${uploadError.message}`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('announcement-images')
          .getPublicUrl(fileName);

        console.log('Public URL:', publicUrl);

        if (editor) {
          if (file.type.startsWith('video/')) {
            console.log('Inserting video into editor');
            editor.chain().focus().setVideo({ src: publicUrl }).run();
          } else {
            console.log('Inserting image into editor');
            editor.chain().focus().setImage({ src: publicUrl }).run();
          }
        }
      }

      setUploadProgress(100);
      setUploadStatus('Upload complete!');
      setTimeout(() => {
        setUploadStatus('');
        setUploadProgress(0);
      }, 2000);
    } catch (error: any) {
      console.error('Error uploading video:', error);
      setUploadStatus(`Error: ${error.message}`);
      setTimeout(() => {
        setUploadStatus('');
        setUploadProgress(0);
      }, 3000);
    } finally {
      setUploading(false);
      if (videoInputRef.current) {
        videoInputRef.current.value = '';
      }
    }
  };

  const handleVideoButtonClick = () => {
    videoInputRef.current?.click();
  };

  const handleWordImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.docx')) {
      setUploadStatus('Error: Please select a .docx file');
      setTimeout(() => setUploadStatus(''), 3000);
      return;
    }

    setUploading(true);
    setUploadStatus('Importing Word document...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const mammothModule = await import('mammoth');
      const mammoth = mammothModule.default || mammothModule;

      let imageCount = 0;
      const uploadImageDuringConversion = async (image: any) => {
        try {
          const imageBuffer: string = await image.read("base64");
          const contentType: string = image.contentType || 'image/png';
          imageCount++;
          setUploadStatus(`Uploading image ${imageCount} from Word...`);

          const byteString = atob(imageBuffer);
          const uint8Array = new Uint8Array(byteString.length);
          for (let j = 0; j < byteString.length; j++) {
            uint8Array[j] = byteString.charCodeAt(j);
          }
          const blob = new Blob([uint8Array], { type: contentType });
          let ext = contentType.split('/')[1] || 'png';
          if (ext === 'jpeg') ext = 'jpg';
          const fileName = `${adminId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from('chat-images')
            .upload(fileName, blob, { cacheControl: '3600', upsert: false, contentType });

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('chat-images')
              .getPublicUrl(fileName);
            return { src: publicUrl };
          }
        } catch (err) {
          console.error('Error uploading Word image:', err);
        }
        return { src: `data:${image.contentType || 'image/png'};base64,${await image.read("base64")}` };
      };

      const convertOptions: any = {};
      if (mammoth.images && mammoth.images.imgElement) {
        convertOptions.convertImage = mammoth.images.imgElement(uploadImageDuringConversion);
      }

      const result = await mammoth.convertToHtml({ arrayBuffer }, convertOptions);

      if (result.value) {
        if (editor) {
          editor.chain().focus().insertContent(result.value).run();
        }
        setUploadStatus(imageCount > 0
          ? `Word document imported with ${imageCount} image(s)!`
          : 'Word document imported successfully!');
      } else {
        setUploadStatus('Error: Could not parse document');
      }

      if (result.messages.length > 0) {
        console.warn('Word import warnings:', result.messages);
      }
    } catch (error: any) {
      console.error('Error importing Word document:', error);
      setUploadStatus(`Error: ${error.message}`);
    } finally {
      setUploading(false);
      setTimeout(() => setUploadStatus(''), 3000);
      if (wordInputRef.current) {
        wordInputRef.current.value = '';
      }
    }
  };

  const handleWordButtonClick = () => {
    wordInputRef.current?.click();
  };

  useImperativeHandle(ref, () => ({
    insertImage: (url: string) => {
      if (editor) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    },
    insertVideo: (url: string) => {
      if (editor) {
        editor.chain().focus().setVideo({ src: url }).run();
      }
    },
    getEditor: () => editor,
    getContent: () => {
      if (editor) {
        return editor.getHTML();
      }
      return '';
    }
  }));

  if (!editor) {
    return null;
  }

  const MenuButton = ({
    onClick,
    active,
    children,
    title,
    disabled
  }: {
    onClick: () => void;
    active?: boolean;
    children: React.ReactNode;
    title: string;
    disabled?: boolean;
  }) => {
    return (
      <button
        type="button"
        onMouseDown={(e) => {
          // Prevent default to keep the editor selection
          e.preventDefault();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        title={title}
        disabled={disabled}
        className={`
          p-1.5 rounded-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
          ${active
            ? theme === 'light' ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'bg-blue-600 text-white'
            : theme === 'light' ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-200' : 'text-slate-400 hover:text-white hover:bg-slate-700'
          }
        `}
      >
        {children}
      </button>
    );
  };

  return (
    <>
      <style>{`
        .ProseMirror ul,
        .ProseMirror ol {
          padding-left: 2rem !important;
          margin: 1rem 0 !important;
        }
        .ProseMirror ul {
          list-style-type: disc !important;
        }
        .ProseMirror ol {
          list-style-type: decimal !important;
        }
        .ProseMirror li {
          display: list-item !important;
          list-style-position: outside !important;
          margin-left: 0 !important;
          padding-left: 0 !important;
        }
        .ProseMirror ul ul {
          list-style-type: circle !important;
          margin: 0.5rem 0 !important;
        }
        .ProseMirror ol ol {
          list-style-type: lower-alpha !important;
          margin: 0.5rem 0 !important;
        }
        .ProseMirror li p {
          margin: 0 !important;
        }
        .ProseMirror video {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 1rem 0;
          display: block;
          background: rgba(0, 0, 0, 0.3);
        }
        .tiptap-editor-wrapper {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
        }
        .tiptap-editor-wrapper::-webkit-scrollbar {
          width: 8px;
        }
        .tiptap-editor-wrapper::-webkit-scrollbar-track {
          background: rgba(51, 65, 85, 0.3);
          border-radius: 4px;
        }
        .tiptap-editor-wrapper::-webkit-scrollbar-thumb {
          background: rgba(59, 130, 246, 0.5);
          border-radius: 4px;
        }
        .tiptap-editor-wrapper::-webkit-scrollbar-thumb:hover {
          background: rgba(59, 130, 246, 0.7);
        }
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(200%);
          }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        multiple
        className="hidden"
        disabled={uploading}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/ogg"
        onChange={handleVideoUpload}
        multiple
        className="hidden"
        disabled={uploading}
      />
      <input
        ref={wordInputRef}
        type="file"
        accept=".docx"
        onChange={handleWordImport}
        className="hidden"
        disabled={uploading}
      />

      <div className={`rounded-lg overflow-hidden flex flex-col h-full ${theme === 'light' ? 'border-0 bg-white' : 'border border-slate-700 bg-slate-900'}`}>
        {editable && (
          <div className={`flex flex-wrap items-center gap-1 p-2 border-b flex-shrink-0 ${theme === 'light' ? 'border-slate-200 bg-slate-50/80' : 'border-slate-700 bg-slate-800/50'}`}>
            <MenuButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={editor.isActive('bold')}
              title="Bold (Ctrl+B)"
            >
              <Bold className="w-4 h-4" />
            </MenuButton>

            <MenuButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={editor.isActive('italic')}
              title="Italic (Ctrl+I)"
            >
              <Italic className="w-4 h-4" />
            </MenuButton>

            <div className={`w-px h-6 mx-1 ${theme === 'light' ? 'bg-slate-200' : 'bg-slate-700'}`} />

            <MenuButton
              onClick={() => editor.chain().focus().toggleTextSize('2em').run()}
              active={editor.isActive('textSize', { size: '2em' })}
              title="Large Text (H1 size)"
            >
              <Heading1 className="w-4 h-4" />
            </MenuButton>

            <MenuButton
              onClick={() => editor.chain().focus().toggleTextSize('1.5em').run()}
              active={editor.isActive('textSize', { size: '1.5em' })}
              title="Medium Text (H2 size)"
            >
              <Heading2 className="w-4 h-4" />
            </MenuButton>

            <MenuButton
              onClick={() => editor.chain().focus().toggleTextSize('1.25em').run()}
              active={editor.isActive('textSize', { size: '1.25em' })}
              title="Small Heading (H3 size)"
            >
              <Heading3 className="w-4 h-4" />
            </MenuButton>

            <div className={`w-px h-6 mx-1 ${theme === 'light' ? 'bg-slate-200' : 'bg-slate-700'}`} />

            <MenuButton
              onClick={() => {
                const { state } = editor;
                const { from, to, empty } = state.selection;

                if (empty) {
                  // No selection, toggle list for current block
                  editor.commands.toggleBulletList();
                } else {
                  const $from = state.doc.resolve(from);
                  const $to = state.doc.resolve(to);

                  // Check if selection is at block boundaries
                  const isAtBlockStart = from === $from.start($from.depth);
                  const isAtBlockEnd = to === $to.end($to.depth);

                  if (isAtBlockStart && isAtBlockEnd) {
                    // Selection spans complete blocks, safe to toggle
                    editor.commands.toggleBulletList();
                  } else {
                    // Partial selection - split the paragraph first, then apply list
                    const chain = editor.chain();

                    // If not at end, split after selection
                    if (!isAtBlockEnd) {
                      chain.setTextSelection(to).splitBlock();
                    }

                    // If not at start, split before selection
                    if (!isAtBlockStart) {
                      chain.setTextSelection(from).splitBlock();
                    }

                    // Now toggle list on the newly created block
                    chain.toggleBulletList().run();
                  }
                }
              }}
              active={editor.isActive('bulletList')}
              title="Bullet List"
            >
              <List className="w-4 h-4" />
            </MenuButton>

            <MenuButton
              onClick={() => {
                const { state } = editor;
                const { from, to, empty } = state.selection;

                if (empty) {
                  // No selection, toggle list for current block
                  editor.commands.toggleOrderedList();
                } else {
                  const $from = state.doc.resolve(from);
                  const $to = state.doc.resolve(to);

                  // Check if selection is at block boundaries
                  const isAtBlockStart = from === $from.start($from.depth);
                  const isAtBlockEnd = to === $to.end($to.depth);

                  if (isAtBlockStart && isAtBlockEnd) {
                    // Selection spans complete blocks, safe to toggle
                    editor.commands.toggleOrderedList();
                  } else {
                    // Partial selection - split the paragraph first, then apply list
                    const chain = editor.chain();

                    // If not at end, split after selection
                    if (!isAtBlockEnd) {
                      chain.setTextSelection(to).splitBlock();
                    }

                    // If not at start, split before selection
                    if (!isAtBlockStart) {
                      chain.setTextSelection(from).splitBlock();
                    }

                    // Now toggle list on the newly created block
                    chain.toggleOrderedList().run();
                  }
                }
              }}
              active={editor.isActive('orderedList')}
              title="Numbered List"
            >
              <ListOrdered className="w-4 h-4" />
            </MenuButton>

            <div className={`w-px h-6 mx-1 ${theme === 'light' ? 'bg-slate-200' : 'bg-slate-700'}`} />

            <MenuButton
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
              active={editor.isActive({ textAlign: 'left' })}
              title="Align Left"
            >
              <AlignLeft className="w-4 h-4" />
            </MenuButton>

            <MenuButton
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
              active={editor.isActive({ textAlign: 'center' })}
              title="Align Center"
            >
              <AlignCenter className="w-4 h-4" />
            </MenuButton>

            <MenuButton
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
              active={editor.isActive({ textAlign: 'right' })}
              title="Align Right"
            >
              <AlignRight className="w-4 h-4" />
            </MenuButton>

            <div className={`w-px h-6 mx-1 ${theme === 'light' ? 'bg-slate-200' : 'bg-slate-700'}`} />

            <div className="relative">
              <MenuButton
                onClick={() => { setShowColorPicker(!showColorPicker); setShowBgColorPicker(false); }}
                title="Text Color"
              >
                <div className="flex flex-col items-center gap-0">
                  <span className="text-xs font-semibold leading-none">A</span>
                  <div
                    className="w-4 h-1 rounded-sm mt-0.5"
                    style={{ backgroundColor: editor.getAttributes('textStyle').color || (theme === 'light' ? '#000000' : '#ffffff') }}
                  />
                </div>
              </MenuButton>
              {showColorPicker && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowColorPicker(false)}
                  />
                  <div className={`absolute top-full left-0 mt-1 p-2.5 rounded-lg shadow-xl z-20 grid grid-cols-5 gap-1.5 min-w-[160px] ${theme === 'light' ? 'bg-white border border-slate-200 shadow-lg' : 'bg-slate-800 border border-slate-700'}`}>
                    {(theme === 'light' ? ['#000000', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#ffffff'] : ['#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#000000']).map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          editor.chain().focus().setColor(color).run();
                          setShowColorPicker(false);
                        }}
                        className={`w-7 h-7 rounded-md border-2 hover:scale-110 hover:border-blue-500 transition-all cursor-pointer ${theme === 'light' ? 'border-slate-200' : 'border-slate-600'}`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <MenuButton
                onClick={() => { setShowBgColorPicker(!showBgColorPicker); setShowColorPicker(false); }}
                active={editor.isActive('highlightBg')}
                title="Background Color"
              >
                <Highlighter className="w-4 h-4" />
              </MenuButton>
              {showBgColorPicker && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowBgColorPicker(false)}
                  />
                  <div className={`absolute top-full left-0 mt-1 p-2.5 rounded-lg shadow-xl z-20 min-w-[160px] ${theme === 'light' ? 'bg-white border border-slate-200 shadow-lg' : 'bg-slate-800 border border-slate-700'}`}>
                    <div className="grid grid-cols-5 gap-1.5">
                      {['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#fed7aa', '#fce7f3', '#ccfbf1', '#e2e8f0', '#fde68a'].map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            (editor.chain().focus() as any).setHighlightBg(color).run();
                            setShowBgColorPicker(false);
                          }}
                          className={`w-7 h-7 rounded-md border-2 hover:scale-110 hover:border-blue-500 transition-all cursor-pointer ${theme === 'light' ? 'border-slate-200' : 'border-slate-600'}`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        (editor.chain().focus() as any).unsetHighlightBg().run();
                        setShowBgColorPicker(false);
                      }}
                      className={`w-full mt-2 px-2 py-1 text-[11px] font-bold rounded-md transition-all text-center ${theme === 'light' ? 'text-red-500 bg-red-50 border border-red-200 hover:bg-red-100' : 'text-red-400 bg-red-900/30 border border-red-700/50 hover:bg-red-900/50'}`}
                    >
                      Clear
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className={`w-px h-6 mx-1 ${theme === 'light' ? 'bg-slate-200' : 'bg-slate-700'}`} />

            <MenuButton
              onClick={handleImageButtonClick}
              disabled={uploading}
              title={uploading ? uploadStatus : "Upload Image"}
            >
              <ImageIcon className="w-4 h-4" />
            </MenuButton>

            <MenuButton
              onClick={handleVideoButtonClick}
              disabled={uploading}
              title={uploading ? uploadStatus : "Upload Video (MP4, WebM)"}
            >
              <VideoIcon className="w-4 h-4" />
            </MenuButton>

            <MenuButton
              onClick={handleWordButtonClick}
              disabled={uploading}
              title="Import Word Document (.docx)"
            >
              <FileText className="w-4 h-4" />
            </MenuButton>

            <div className="flex-1" />

            <MenuButton
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().chain().focus().undo().run()}
              title="Undo (Ctrl+Z)"
            >
              <Undo className="w-4 h-4" />
            </MenuButton>

            <MenuButton
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().chain().focus().redo().run()}
              title="Redo (Ctrl+Y)"
            >
              <Redo className="w-4 h-4" />
            </MenuButton>
          </div>
        )}

        <div
          className="tiptap-editor-wrapper"
          onClick={() => editor?.commands.focus()}
        >
          <EditorContent editor={editor} className={theme === 'light' ? 'text-slate-800' : 'text-white'} />
        </div>

        {uploadStatus && (
          <div className={`px-4 py-3 border-t space-y-2 ${theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/50 border-slate-700'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium ${theme === 'light' ? 'text-slate-600' : 'text-slate-300'}`}>
                {uploading && '⏳ '}{uploadStatus}
              </span>
              {uploading && (
                <span className="text-xs text-blue-400 font-bold">
                  {uploadProgress}%
                </span>
              )}
            </div>
            {uploading && (
              <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-500 to-cyan-500 h-full transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                >
                  <div className="h-full w-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
});

TiptapEditor.displayName = 'TiptapEditor';

export default TiptapEditor;
