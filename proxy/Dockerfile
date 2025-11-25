FROM nginx:1.27-alpine

# Copy the nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
    CMD wget --spider -q http://127.0.0.1/health || exit 1
