# Copilot Instructions for Video Sharing Microservice

## Project Overview
This is a secure video sharing microservice built with Node.js and Express. It allows users to upload videos via drag-and-drop, generates secure unique links for sharing, and integrates with Discord webhooks.

## Key Features
- Secure video upload with file validation
- Unique link generation for each video
- In-browser video preview and download
- Discord webhook integration
- Rate limiting and security middleware
- Dark theme UI with drag-and-drop interface

## Architecture
- **Backend**: Node.js with Express
- **File Upload**: Multer for handling multipart/form-data
- **Security**: Helmet, CORS, rate limiting
- **Storage**: Local file system with in-memory metadata

## Code Patterns
- Use ES modules (import/export) when possible
- Implement proper error handling with try-catch blocks
- Validate all user inputs
- Use middleware for common functionality
- Keep routes modular and organized

## Security Considerations
- Always validate file types and sizes
- Generate cryptographically secure unique IDs
- Implement rate limiting on upload endpoints
- Use proper CORS configuration
- Never expose direct file system paths

## Development Guidelines
- Follow RESTful API conventions
- Use descriptive variable and function names
- Add comments for complex logic
- Handle edge cases gracefully
- Log important events for debugging

## Testing
- Test file upload with various formats
- Verify security measures work correctly
- Test Discord webhook integration
- Check rate limiting functionality
