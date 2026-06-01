import { useRef, useState } from 'react';
import { UploadCloud, FileText, Loader2 } from 'lucide-react';

interface Props {
  onFile: (file: File) => void | Promise<void>;
  busy?: boolean;
  fileName?: string | null;
  accept?: string;
  title?: string;
  hint?: string;
}

const ACCEPT = '.stl,.step,.stp,.iges,.igs,.dxf,.pdf';

export function DropZone({ onFile, busy, fileName, accept, title, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (files && files[0]) onFile(files[0]);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors ${
        dragging
          ? 'border-blue-400 bg-blue-50'
          : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept ?? ACCEPT}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {busy ? (
        <Loader2 size={18} className="text-blue-500 animate-spin shrink-0" />
      ) : fileName ? (
        <FileText size={18} className="text-blue-500 shrink-0" />
      ) : (
        <UploadCloud size={18} className="text-gray-400 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-700 truncate">
          {busy ? 'Parsing…' : fileName ? fileName : title ?? 'Upload drawing or CAD model'}
        </p>
        <p className="text-xs text-gray-400">
          {hint ?? 'STL · STEP · IGES · DXF · PDF — drag & drop or click'}
        </p>
      </div>
    </div>
  );
}
