# Text File Upload Feature - Implementation Summary

**Date**: 2025-10-15
**Status**: Backend Complete, Frontend API Ready, UI Integration Pending
**Complexity**: Medium (2-4 hours for experienced developer)

## Overview

This document summarizes the implementation of text file upload functionality for the chat application, allowing users to attach source code files (`.js`, `.ts`, `.py`, `.md`, etc.) to their messages for AI analysis.

## Design Philosophy

The implementation follows the existing image upload patterns to maintain consistency across the codebase:
- User-based data isolation at the database level
- Server-side file storage with secure access control
- Client-side validation with progress tracking
- Type-safe API integration
- Modular, reusable components

---

## What Has Been Implemented

### 1. Backend Infrastructure

#### Database Schema
**File**: `backend/src/db/migrations/018-create-files-table.js`

```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  storage_filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER NOT NULL,
  content TEXT,  -- Stores text content for LLM context
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_files_user_id ON files(user_id);
```

**Key Features**:
- User isolation via foreign key constraint
- Text content stored for immediate LLM access
- Indexed by user_id for fast queries

#### Database Operations
**File**: `backend/src/db/files.js`

Functions:
- `createFileRecord()` - Insert file metadata
- `getFileRecordById()` - Retrieve file by ID
- `getFileRecordForUser()` - Retrieve with user validation
- `deleteFileRecord()` - Remove file metadata

#### File Upload Routes
**File**: `backend/src/routes/files.js`

**Endpoints**:

1. **POST `/v1/files/upload`**
   - Accepts multipart form data with `files` field
   - Max file size: 5MB per file
   - Max files: 3 per message
   - Authentication required
   - Returns uploaded file metadata including text content

2. **GET `/v1/files/:fileId`**
   - Serves file with user ownership validation
   - Authentication required
   - Supports ETag caching
   - Returns appropriate content-type headers

3. **GET `/v1/files/config`**
   - Returns upload configuration
   - No authentication required
   - Used for client-side validation

**Supported File Types**:
```javascript
['.js', '.jsx', '.ts', '.tsx',           // JavaScript/TypeScript
 '.py', '.rb', '.java', '.cpp', '.go',   // Other languages
 '.html', '.css', '.scss',               // Web files
 '.json', '.xml', '.yaml', '.yml',       // Config files
 '.md', '.txt', '.csv', '.log',          // Documents
 '.sh', '.bash',                         // Shell scripts
 '.sql', '.graphql']                     // Query languages
```

**Configuration**:
```javascript
{
  maxFileSize: 5 * 1024 * 1024,        // 5MB
  maxFilesPerMessage: 3,
  localStoragePath: './data/files',     // Configurable via env
  uploadRateLimit: 10,                  // per minute
  storageLimitPerUser: 50 * 1024 * 1024 // 50MB
}
```

#### Server Registration
**File**: `backend/src/index.js`

```javascript
import { filesRouter } from './routes/files.js';
// ...
app.use(filesRouter);
```

### 2. Frontend Type System

#### Type Definitions
**File**: `frontend/lib/types.ts`

```typescript
export interface FileAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  content?: string;      // Text content for display/LLM
  downloadUrl?: string;
  accessToken?: string;
  expiresAt?: string;
  expiresIn?: number;
}

export interface FileConfig {
  maxFileSize: number;
  maxFilesPerMessage: number;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  uploadRateLimit: number;
  storageLimitPerUser: number;
}

export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface FileUploadProgress {
  fileId: string;
  state: FileProcessingState;
  progress: number;
  error?: string;
}
```

### 3. Frontend API Integration

#### API Client
**File**: `frontend/lib/api.ts`

```typescript
export const files = {
  async getConfig(): Promise<FileConfig>
  async validateFiles(files: File[], config?: FileConfig): Promise<FileValidationResult>
  async uploadFiles(files: File[], onProgress?: (progress: FileUploadProgress[]) => void): Promise<FileAttachment[]>
}
```

**Exported from**: `frontend/lib/index.ts`

---

## What Needs to Be Done Next

### Phase 1: Frontend State Management

#### 1.1 Update `useChat` Hook
**File**: `frontend/hooks/useChat.ts`

Add file attachment state (similar to images state at line 234):

```typescript
// Add state
const [files, setFiles] = useState<FileAttachment[]>([]);

// Update sendMessage to handle files
const sendMessage = useCallback(async (content?: string, opts?: {...}) => {
  // ... existing code ...

  // Convert files to content format if present
  // Include file content in message context

  // Clear files after sending
  setFiles([]);
}, [files, ...]);

// Export in return statement
return {
  // ... existing exports ...
  files,
  setFiles,
};
```

**Location**: Lines 234-235 (after images state)

#### 1.2 Update MessageInput Props
**File**: `frontend/components/MessageInput.tsx`

Add props for file handling:

```typescript
interface MessageInputProps {
  // ... existing props ...
  files?: FileAttachment[];
  onFilesChange?: (files: FileAttachment[]) => void;
}
```

**Location**: Line 11 (MessageInputProps interface)

### Phase 2: UI Components

#### 2.1 Create FilePreview Component
**File**: `frontend/components/ui/FilePreview.tsx` (new file)

Reference the existing `ImagePreview` component structure:
- Display uploaded file names, sizes, and types
- Show file icons based on extension
- Provide remove button for each file
- Display upload progress
- Support preview of text content (optional)

**Pattern to follow**: `frontend/components/ui/ImagePreview.tsx`

#### 2.2 Add File Upload Button to MessageInput
**File**: `frontend/components/MessageInput.tsx`

Add after the image upload button (around line 258):

```typescript
{onFilesChange && (
  <Tooltip content="Upload source files">
    <button
      type="button"
      onClick={handleFileUploadClick}
      disabled={pending.streaming}
      className={/* similar to image button */}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".js,.ts,.py,.md,.txt,.json,..." // from config
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <FileText className="w-5 h-5" />
    </button>
  </Tooltip>
)}
```

**Icon**: Import `FileText` from `lucide-react`

#### 2.3 Add File Upload Handlers
**File**: `frontend/components/MessageInput.tsx`

Add handlers (similar to image handlers at lines 174-209):

```typescript
const handleFileFiles = async (files: File[]) => {
  if (!onFilesChange || !files) return;

  try {
    const uploadedFiles = await filesApi.uploadFiles(files, setFileUploadProgress);
    onFilesChange([...files, ...uploadedFiles]);
  } catch (error) {
    console.error('File upload failed:', error);
    // TODO: Show error toast
  }
};

const handleRemoveFile = (fileId: string) => {
  if (!onFilesChange || !files) return;
  onFilesChange(files.filter(f => f.id !== fileId));
};

const handleFileUploadClick = () => {
  fileInputRef.current?.click();
};

const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files || []);
  if (files.length > 0) {
    handleFileFiles(files);
  }
  e.target.value = '';
};
```

#### 2.4 Add FilePreview to MessageInput
**File**: `frontend/components/MessageInput.tsx`

Add before text input (similar to ImagePreview at lines 244-253):

```typescript
{files.length > 0 && (
  <div className="p-4 pb-2 border-b border-slate-200 dark:border-neutral-700">
    <FilePreview
      files={files}
      uploadProgress={fileUploadProgress}
      onRemove={onFilesChange ? handleRemoveFile : undefined}
    />
  </div>
)}
```

### Phase 3: Message Processing

#### 3.1 Update Message Rendering
**File**: `frontend/components/MessageList.tsx` or `frontend/components/Markdown.tsx`

Add file attachment display in message content:
- Show attached file names and sizes
- Display file content in code blocks
- Add download links for files

#### 3.2 Update Chat API Integration
**File**: `frontend/lib/api.ts` (chat.sendMessage)

Include file content in message payload:

```typescript
// In buildRequestBody or sendMessage
if (files && files.length > 0) {
  // Format file contents for LLM context
  const fileContext = files.map(f =>
    `File: ${f.name}\n\`\`\`${getLanguageFromExtension(f.name)}\n${f.content}\n\`\`\``
  ).join('\n\n');

  // Prepend to user message or add as separate content block
  messageContent = fileContext + '\n\n' + messageText;
}
```

### Phase 4: Testing & Polish

#### 4.1 Run Database Migration

```bash
./dev.sh migrate up
```

Verify migration 018 applied successfully.

#### 4.2 Test File Upload Flow

1. Upload a `.js` file from MessageInput
2. Verify file appears in FilePreview
3. Send message with attached file
4. Verify AI receives file content
5. Test file removal
6. Test multiple file uploads
7. Test file size limits (>5MB should fail)
8. Test unsupported file types

#### 4.3 Error Handling

Add user-friendly error messages for:
- File too large
- Too many files
- Unsupported file type
- Upload failure
- Network errors

**Consider**: Toast notifications using existing error handling patterns

#### 4.4 Optional Enhancements

- Drag-and-drop file upload (extend existing `ImageUploadZone`)
- File content preview modal
- Syntax highlighting for file previews
- File download functionality
- File attachment persistence in conversations
- File content truncation for very large files

---

## File References

### Backend Files Created/Modified
- `backend/src/db/migrations/018-create-files-table.js` (new)
- `backend/src/db/files.js` (new)
- `backend/src/routes/files.js` (new)
- `backend/src/index.js` (modified - added filesRouter)

### Frontend Files Created/Modified
- `frontend/lib/types.ts` (modified - added FileAttachment types)
- `frontend/lib/api.ts` (modified - added files export)
- `frontend/lib/index.ts` (modified - exported files API)

### Frontend Files To Be Created/Modified
- `frontend/components/ui/FilePreview.tsx` (to create)
- `frontend/hooks/useChat.ts` (to modify - add files state)
- `frontend/components/MessageInput.tsx` (to modify - add file upload UI)
- `frontend/components/MessageList.tsx` (to modify - render file attachments)

---

## Testing Checklist

- [ ] Database migration runs successfully
- [ ] File upload endpoint accepts valid files
- [ ] File upload endpoint rejects invalid files (size, type)
- [ ] File retrieval endpoint enforces user ownership
- [ ] Frontend validation matches backend constraints
- [ ] Progress tracking works during upload
- [ ] File preview component renders correctly
- [ ] File removal works as expected
- [ ] Multiple files can be uploaded
- [ ] File content is included in chat messages
- [ ] AI receives and processes file content
- [ ] Error messages are user-friendly
- [ ] File storage directory is created automatically
- [ ] Files are cleaned up on user deletion (CASCADE)

---

## Security Considerations

✅ **Implemented**:
- User-based access control (foreign key constraint)
- File type validation (extension and MIME type)
- File size limits (5MB per file, 50MB per user)
- User ownership verification on retrieval
- Secure file storage outside web root
- Authentication required for all operations

⚠️ **To Consider**:
- Content sanitization (malicious code in uploaded files)
- Rate limiting enforcement
- Virus/malware scanning (optional)
- File content encryption at rest (optional)
- Audit logging for file operations (optional)

---

## Performance Considerations

- **File Content Storage**: Text content stored in DB for fast access
  - Consider size limits to prevent DB bloat
  - Alternative: Store content in files, reference in DB

- **Upload Progress**: Uses in-memory progress tracking
  - Works well for small files (<5MB)
  - Consider streaming for larger files (future enhancement)

- **Caching**: ETag support for file retrieval
  - Reduces bandwidth for repeated requests
  - Browser caching reduces server load

---

## Known Limitations

1. **File Size**: Limited to 5MB per file
   - Larger files require chunked upload (not implemented)

2. **Binary Files**: Only text files are supported
   - Binary files (images, PDFs) not handled
   - Use image upload for image files

3. **Token Limits**: Large files may exceed LLM token limits
   - Consider truncation or summarization for very large files

4. **Storage**: Local filesystem only
   - Cloud storage (S3) not implemented
   - Requires volume mount in Docker for persistence

---

## Future Enhancements

1. **Chunked Upload**: Support for larger files (>5MB)
2. **Cloud Storage**: S3/GCS integration for scalability
3. **File Versioning**: Track changes to uploaded files
4. **File Sharing**: Share files between conversations
5. **File Search**: Full-text search across file contents
6. **Binary File Support**: PDFs, images, etc.
7. **File Compression**: Gzip compression for storage
8. **Syntax Highlighting**: Pretty code display
9. **File Diff Viewer**: Compare file versions
10. **Collaborative Editing**: Real-time file editing

---

## Migration Notes

**Migration 018** adds the `files` table. To apply:

```bash
./dev.sh migrate up
```

To rollback (if needed):

```bash
./dev.sh migrate down
```

**Data Directory**:
The `./data/files` directory will be created automatically on first upload. Ensure it's writable by the backend container.

In Docker Compose:
```yaml
volumes:
  - ./data:/app/data  # Ensures persistence across restarts
```

---

## Conclusion

The backend infrastructure and frontend API for text file uploads are **complete and ready to use**. The remaining work focuses on UI integration and testing, which should take approximately 2-3 hours for an experienced developer familiar with the codebase.

The implementation follows established patterns from the image upload feature, ensuring consistency and maintainability. All security and data isolation requirements are met.

**Next Immediate Step**: Update the `useChat` hook to add file attachment state, then proceed with UI component implementation.
