1. **Define Requirements**
   - Users should be able to upload images in chat.
   - Uploaded images should be displayed in the chat interface.
   - Implement image preview before sending.
   - Support various image formats (e.g., JPG, PNG, GIF, WebP).
   - **Enhanced Requirements:**
     - Maximum file size limits (e.g., 10MB per image)
     - Security considerations (image validation, malware scanning)
     - Accessibility features (alt text, screen reader support)
     - Mobile responsiveness for image uploads
     - Image compression/optimization before upload
     - Support for image URLs (not just file uploads)
     - Paste image from clipboard support
    Read [IMAGE_SUPPORT_REQUIREMENTS.md](docs/IMAGE_SUPPORT_REQUIREMENTS.md) for more details.

2. **Research OpenAI Vision API and OpenRouter API**
   - Investigate the API documentation for image upload endpoints.
   - **Key Findings:**
     - OpenAI Vision API uses multipart content format in messages
     - OpenRouter supports vision models (GPT-4V, Claude 3, etc.) with OpenAI-compatible format
     - Need to extend ChatMessage interface to support mixed content:
       ```typescript
       content: string | Array<{
         type: 'text' | 'image_url',
         text?: string,
         image_url?: { url: string, detail?: string }
       }>
       ```
     - Current ChatClient should work with minimal modifications
     - Images need to be base64 encoded or accessible via URL

3. **Design UI/UX**
   - Update chat input area to include an image upload button.
   - Implement drag-and-drop functionality for image uploads.
   - Design image preview component.
   - **Enhanced UI/UX Features:**
     - Image upload button next to send button in MessageInput
     - Drag & drop overlay for the entire input area
     - Image thumbnail preview with remove option
     - Progress indicator for uploads
     - Image compression settings toggle
     - Lightbox/modal for full-size viewing in MessageList
     - Loading states while images are being processed
     - Error states for failed uploads
     - Image metadata display (size, dimensions)

4. **Implement Backend Support**
   - Update API to handle image uploads. Store uploaded images in a suitable storage solution (e.g., AWS S3, local storage).
   - Ensure images are properly linked to chat messages in the database.
   - **Technical Implementation Details:**
     - **Storage Strategy:**
       - Local storage for development
       - AWS S3/CloudFront for production
       - Image processing pipeline (resize, compress, format conversion)
       - CDN integration for fast delivery
     - **New API Endpoints:**
       ```
       POST /v1/chat/images/upload
       GET /v1/chat/images/:id
       DELETE /v1/chat/images/:id (for cleanup)
       ```
     - **Database Schema Updates:**
       ```sql
       ALTER TABLE messages ADD COLUMN images JSONB;
       -- Store array of image references with metadata
       ```
     - **Security Measures:**
       - MIME type validation
       - File size limits
       - Image sanitization
       - Virus scanning for production

5. **Integrate Frontend and Backend**
   - Update chat message sending logic to include image data.
   - Display images in chat messages using returned URLs.
   - **Specific Code Changes Required:**
     - **ChatClient Extension:**
       ```typescript
       // Extend buildRequestBody method in ChatClient
       private buildRequestBody(options: ChatOptions | ChatOptionsExtended, stream: boolean): any {
         // Convert image attachments to proper format
         const messages = options.messages.map(msg => ({
           ...msg,
           content: this.formatMessageContent(msg.content, msg.images)
         }));
         return { ...bodyObj, messages };
       }
       ```
     - **Message Rendering:**
       ```typescript
       // Update MessageList to render images
       const renderMessageContent = (message: ChatMessage) => {
         if (Array.isArray(message.content)) {
           return message.content.map((part, index) =>
             part.type === 'image_url'
               ? <img key={index} src={part.image_url.url} alt="Uploaded image" />
               : <Markdown text={part.text} />
           );
         }
         return <Markdown text={message.content} />;
       };
       ```
     - **TypeScript Interface Updates:**
       - Extend ChatMessage in `lib/chat/types.ts`
       - Add image upload utilities
       - Update useChatState hook for image handling

6. **Testing**
   - Write unit tests for image upload functionality.
   - Perform end-to-end testing of the chat interface with images.
   - **Comprehensive Test Coverage:**
     - **Unit Tests:**
       - Image upload component functionality
       - Image validation (size, format, security)
       - Message content formatting with images
       - ChatClient image handling methods
     - **Integration Tests:**
       - Image upload to backend storage
       - Database image metadata storage
       - API endpoint error handling
     - **E2E Tests:**
       - Complete image upload and send workflow
       - Image display in chat messages
       - Mobile device compatibility
       - Network failure recovery scenarios
     - **Performance Tests:**
       - Multiple image uploads
       - Large file handling
       - Image compression quality
     - **Security Tests:**
       - Malicious file upload attempts
       - MIME type validation
       - File size limit enforcement

## Additional Recommendations

7. **Security & Performance Considerations**
   - **Client-side Validation:**
     - Image format validation before upload
     - File size checking
     - MIME type verification
   - **Performance Optimizations:**
     - Image compression before upload
     - WebP format conversion
     - Lazy loading for image rendering
     - CDN integration for fast delivery
   - **Security Measures:**
     - Rate limiting on image uploads
     - Virus scanning in production
     - Image sanitization and processing

8. **User Experience Enhancements**
   - **Advanced Features:**
     - Multiple image selection and batch upload
     - Image editing tools (crop, rotate, resize)
     - Image search and organization
     - Drag & drop from external sources
   - **Accessibility:**
     - Keyboard navigation for image uploads
     - Screen reader compatibility
     - Alt text editing interface

9. **Configuration Management**
   ```typescript
   interface ImageConfig {
     maxFileSize: number;           // e.g., 10MB
     allowedFormats: string[];      // ['jpg', 'jpeg', 'png', 'gif', 'webp']
     compressionQuality: number;    // 0.8
     enableCloudStorage: boolean;   // true for production
     cdnBaseUrl?: string;          // CloudFront URL
     enableImageEditing: boolean;   // false initially
   }
   ```

## Implementation Priority

**Phase 1: Core Functionality**
1. Extend TypeScript interfaces (ChatMessage, etc.)
2. Add basic file upload UI to MessageInput
3. Implement image storage API endpoints
4. Update ChatClient to handle image content
5. Add image rendering to MessageList

**Phase 2: Enhanced Features**
1. Image compression and optimization
2. Drag & drop functionality
3. Image preview and editing
4. Error handling and loading states
5. Mobile responsiveness improvements

**Phase 3: Production Ready**
1. Security hardening and validation
2. Performance optimization and CDN
3. Comprehensive testing suite
4. Accessibility compliance
5. Analytics and monitoring

**Recommended Starting Point:**
- Begin with API research and simple image upload test
- Use base64 encoding initially, migrate to file storage later
- Test with OpenAI GPT-4V first, then expand to other providers
- Focus on getting basic functionality working before adding advanced features
